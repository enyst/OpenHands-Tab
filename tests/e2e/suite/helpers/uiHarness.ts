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

type WebviewTargetHint = {
  host?: string;
  pathname?: string;
  extensionId?: string;
  title?: string;
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
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }>();
  private defaultContextId: number | null = null;
  private defaultTimeoutMs: number;

  private constructor(ws: WebSocket, defaultTimeoutMs: number) {
    this.ws = ws;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.ws.on('message', (data) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message?.method === 'Runtime.executionContextCreated') {
        const context = message.params?.context;
        const aux = context?.auxData;
        if (aux?.isDefault || aux?.type === 'default' || context?.name === '') {
          this.defaultContextId = context.id;
        }
      } else if (message?.method === 'Runtime.executionContextDestroyed') {
        if (message.params?.executionContextId === this.defaultContextId) {
          this.defaultContextId = null;
        }
      } else if (message?.method === 'Runtime.executionContextsCleared') {
        this.defaultContextId = null;
      }
      if (typeof message?.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP error'));
        return;
      }
      pending.resolve(message.result);
    });

    this.ws.on('close', () => {
      for (const pending of this.pending.values()) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });

    this.ws.on('error', (error) => {
      for (const pending of this.pending.values()) {
        if (pending.timer) clearTimeout(pending.timer);
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
    return new CdpClient(ws, timeoutMs);
  }

  async send(method: string, params?: Record<string, any>): Promise<any> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket is not open (state ${this.ws.readyState})`));
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${this.defaultTimeoutMs}ms`));
      }, this.defaultTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  async waitForDefaultContext(timeoutMs: number): Promise<void> {
    await waitForCondition('execution context', async () => this.defaultContextId !== null, timeoutMs);
  }

  async evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      contextId: this.defaultContextId ?? undefined,
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
  webviewInfo?: WebviewTargetHint | null;
}): Promise<WebviewSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extensionId = options.webviewInfo?.extensionId ?? options.extensionId ?? 'openhands.openhands-tab';
  const targetHint: WebviewTargetHint | null = options.webviewInfo
    ? {
        host: options.webviewInfo.host,
        pathname: options.webviewInfo.pathname,
        extensionId,
        title: options.webviewInfo.title,
      }
    : extensionId
      ? { extensionId }
      : null;

  const target = await waitForWebviewTarget(options.port, targetHint, timeoutMs);
  if (!target?.webSocketDebuggerUrl) {
    const targets = await getWebviewTargets(options.port);
    const targetUrls = targets.map((item) => `${item.type ?? 'unknown'}:${item.url ?? 'unknown'}`);
    const hintLabel = targetHint ? JSON.stringify(targetHint) : 'none';
    throw new Error(`Unable to find OpenHands webview target (hint=${hintLabel}). Targets: ${targetUrls.join(' | ')}`);
  }

  console.log(`UI E2E: attaching to webview target (${target.type ?? 'unknown'}) ${target.url ?? 'unknown'}`);

  const client = await CdpClient.connect(target.webSocketDebuggerUrl, timeoutMs);
  await client.send('Runtime.enable');
  await client.waitForDefaultContext(timeoutMs);

  const evaluate = <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) => client.evaluate<T>(fn, ...args);

  const waitForSelector = async (selector: string, options?: WaitForSelectorOptions) => {
    const requireVisible = options?.visible ?? false;
    const deadlineMs = options?.timeoutMs ?? timeoutMs;
    try {
      await waitForCondition(
        `selector ${selector}`,
        async () =>
          evaluate((sel, visible) => {
            if (typeof document === 'undefined') return false;
            const shadowRoot = document.body?.shadowRoot ?? null;
            const el = document.querySelector(sel) ?? shadowRoot?.querySelector(sel) ?? null;
            if (!el) return false;
            if (!visible) return true;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, selector, requireVisible),
        deadlineMs,
      );
    } catch (error) {
      let debug: any = null;
      try {
        debug = await evaluate(() => {
          if (typeof document === 'undefined') return { readyState: 'no-document' };
          const shadowRoot = document.body?.shadowRoot ?? null;
          const testIds = Array.from(document.querySelectorAll('[data-testid]'))
            .concat(Array.from(shadowRoot?.querySelectorAll('[data-testid]') ?? []))
            .slice(0, 10)
            .map((node) => node.getAttribute('data-testid'));
          const root = document.getElementById('root');
          const bodyText = document.body?.textContent?.trim() ?? '';
          return {
            readyState: document.readyState,
            title: document.title,
            testIds,
            bodyHasShadowRoot: Boolean(shadowRoot),
            rootExists: Boolean(root),
            rootChildCount: root?.childElementCount ?? 0,
            bodyTextSample: bodyText.slice(0, 200),
          };
        });
      } catch {
        debug = { readyState: 'unknown' };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}. Debug: ${JSON.stringify(debug)}`);
    }
  };

  const click = async (selector: string) => {
    const clicked = await evaluate((sel) => {
      if (typeof document === 'undefined') return false;
      const shadowRoot = document.body?.shadowRoot ?? null;
      const el = (document.querySelector(sel) ?? shadowRoot?.querySelector(sel)) as HTMLElement | null;
      if (!el) return false;
      el.click();
      return true;
    }, selector);
    if (!clicked) throw new Error(`Unable to click selector: ${selector}`);
  };

  const clickByText = async (tag: string, text: string) => {
    const clicked = await evaluate((tagName, textValue) => {
      if (typeof document === 'undefined') return false;
      const shadowRoot = document.body?.shadowRoot ?? null;
      const nodes = Array.from(document.querySelectorAll(tagName))
        .concat(Array.from(shadowRoot?.querySelectorAll(tagName) ?? []));
      const match = nodes.find((node) => (node.textContent ?? '').trim().includes(textValue));
      if (!match) return false;
      (match as HTMLElement).click();
      return true;
    }, tag, text);
    if (!clicked) throw new Error(`Unable to click ${tag} containing text: ${text}`);
  };

  const getAttribute = (selector: string, name: string) =>
    evaluate((sel, attr) => {
      if (typeof document === 'undefined') return null;
      const shadowRoot = document.body?.shadowRoot ?? null;
      return (document.querySelector(sel) ?? shadowRoot?.querySelector(sel))?.getAttribute(attr) ?? null;
    }, selector, name);

  const count = (selector: string) =>
    evaluate((sel) => {
      if (typeof document === 'undefined') return 0;
      const shadowRoot = document.body?.shadowRoot ?? null;
      return document.querySelectorAll(sel).length + (shadowRoot?.querySelectorAll(sel).length ?? 0);
    }, selector);

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

function pickWebviewTarget(targets: CdpTarget[], hint: WebviewTargetHint | null): CdpTarget | null {
  const matchesHint = (target: CdpTarget): boolean => {
    if (!hint) return true;
    if (hint.extensionId && !target.url?.includes(`extensionId=${hint.extensionId}`)) return false;
    if (hint.title && !target.title?.includes(hint.title)) return false;
    if (hint.host || hint.pathname) {
      if (!target.url) return false;
      try {
        const url = new URL(target.url);
        if (hint.host && url.host !== hint.host) return false;
        if (hint.pathname && url.pathname !== hint.pathname) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  const primaryCandidates = targets.filter(matchesHint);
  const fallbackCandidates = hint?.extensionId
    ? targets.filter((target) => target.url?.includes(`extensionId=${hint.extensionId}`))
    : targets;

  const candidates = primaryCandidates.length > 0 ? primaryCandidates : fallbackCandidates;
  const iframeCandidates = candidates.filter((target) => target.type === 'iframe');
  const pageCandidates = candidates.filter((target) => target.type === 'page');
  const pickIndex = (list: CdpTarget[]) =>
    list.find((target) => target.url?.includes('index.html')) ?? list[0] ?? null;

  return pickIndex(iframeCandidates) ?? pickIndex(pageCandidates) ?? candidates[0] ?? null;
}

async function waitForWebviewTarget(
  port: number,
  hint: WebviewTargetHint | null,
  timeoutMs: number
): Promise<CdpTarget | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await getWebviewTargets(port);
    const match = pickWebviewTarget(targets, hint);
    if (match) return match;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}
