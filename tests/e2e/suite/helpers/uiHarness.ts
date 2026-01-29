import WebSocket from 'ws';

type CdpTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type WaitForSelectorOptions = {
  timeoutMs?: number;
  visible?: boolean;
};

export type WebviewSession = {
  evaluate: <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) => Promise<T>;
  waitForSelector: (selector: string, options?: WaitForSelectorOptions) => Promise<void>;
  click: (selector: string) => Promise<void>;
  clickByText: (tag: string, text: string) => Promise<void>;
  getAttribute: (selector: string, name: string) => Promise<string | null>;
  count: (selector: string) => Promise<number>;
  close: () => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 200;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  label: string,
  condition: () => Promise<boolean>,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (data) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof message?.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP error'));
        return;
      }
      pending.resolve(message.result);
    });

    this.ws.on('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });

    this.ws.on('error', (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string, timeoutMs: number): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to CDP websocket')), timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new CdpClient(ws);
  }

  async send(method: string, params?: Record<string, any>): Promise<any> {
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  async evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) {
      const text = result.exceptionDetails.text ?? 'Runtime.evaluate failed';
      throw new Error(text);
    }
    return result?.result?.value as T;
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

export async function connectToWebviewCdp(options: {
  port: number;
  timeoutMs?: number;
  extensionId?: string;
}): Promise<WebviewSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extensionId = options.extensionId ?? 'openhands.openhands-tab';

  const target = await waitForWebviewTarget(options.port, extensionId, timeoutMs);
  if (!target?.webSocketDebuggerUrl) {
    const targets = await getWebviewTargets(options.port);
    const targetUrls = targets.map((item) => `${item.type ?? 'unknown'}:${item.url ?? 'unknown'}`);
    throw new Error(`Unable to find OpenHands webview target. Targets: ${targetUrls.join(' | ')}`);
  }

  const client = await CdpClient.connect(target.webSocketDebuggerUrl, timeoutMs);
  await client.send('Runtime.enable');

  const evaluate = <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) => client.evaluate<T>(fn, ...args);

  const waitForSelector = async (selector: string, options?: WaitForSelectorOptions) => {
    const requireVisible = options?.visible ?? false;
    const deadlineMs = options?.timeoutMs ?? timeoutMs;
    await waitForCondition(
      `selector ${selector}`,
      async () =>
        evaluate((sel, visible) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          if (!visible) return true;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }, selector, requireVisible),
      deadlineMs,
    );
  };

  const click = async (selector: string) => {
    const clicked = await evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return false;
      el.click();
      return true;
    }, selector);
    if (!clicked) throw new Error(`Unable to click selector: ${selector}`);
  };

  const clickByText = async (tag: string, text: string) => {
    const clicked = await evaluate((tagName, textValue) => {
      const nodes = Array.from(document.querySelectorAll(tagName));
      const match = nodes.find((node) => (node.textContent ?? '').trim().includes(textValue));
      if (!match) return false;
      (match as HTMLElement).click();
      return true;
    }, tag, text);
    if (!clicked) throw new Error(`Unable to click ${tag} containing text: ${text}`);
  };

  const getAttribute = (selector: string, name: string) =>
    evaluate((sel, attr) => document.querySelector(sel)?.getAttribute(attr) ?? null, selector, name);

  const count = (selector: string) =>
    evaluate((sel) => document.querySelectorAll(sel).length, selector);

  return {
    evaluate,
    waitForSelector,
    click,
    clickByText,
    getAttribute,
    count,
    close: () => client.close(),
  };
}

async function getWebviewTargets(port: number): Promise<CdpTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? (data as CdpTarget[]) : [];
  } catch {
    return [];
  }
}

async function waitForWebviewTarget(port: number, extensionId: string, timeoutMs: number): Promise<CdpTarget | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getWebviewTargets(port);
    const match = targets.find((target) => target.url?.includes(extensionId));
    if (match) return match;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}
