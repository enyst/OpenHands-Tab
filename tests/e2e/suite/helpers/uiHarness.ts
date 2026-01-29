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
  private contextsByFrame = new Map<string, number>();
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
        if (aux?.frameId && (aux?.isDefault || aux?.type === 'default')) {
          this.contextsByFrame.set(aux.frameId, context.id);
          if (this.defaultContextId === null) {
            this.defaultContextId = context.id;
          }
        }
      } else if (message?.method === 'Runtime.executionContextDestroyed') {
        if (message.params?.executionContextId === this.defaultContextId) {
          this.defaultContextId = null;
        }
      } else if (message?.method === 'Runtime.executionContextsCleared') {
        this.defaultContextId = null;
        this.contextsByFrame.clear();
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
      let settled = false;
      const cleanup = () => {
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve();
      };
      const onError = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
        reject(new Error('Timed out connecting to CDP websocket'));
      }, timeoutMs);
      ws.once('open', onOpen);
      ws.once('error', onError);
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
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending?.timer) clearTimeout(pending.timer);
      this.pending.delete(id);
      if (pending) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
    return promise;
  }

  async waitForDefaultContext(timeoutMs: number): Promise<void> {
    await waitForCondition('execution context', async () => this.defaultContextId !== null, timeoutMs);
  }

  async waitForFrameContext(frameId: string, timeoutMs: number): Promise<void> {
    await waitForCondition('execution context', async () => this.contextsByFrame.has(frameId), timeoutMs);
    const contextId = this.contextsByFrame.get(frameId) ?? null;
    if (contextId !== null) {
      this.defaultContextId = contextId;
    }
  }

  setDefaultContext(contextId: number): void {
    this.defaultContextId = contextId;
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

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    const candidates = await getWebviewCandidates(options.port, targetHint, timeoutMs);
    for (const candidate of candidates) {
      if (!candidate.webSocketDebuggerUrl) continue;
      console.log(`UI E2E: probing target (${candidate.type ?? 'unknown'}) ${candidate.url ?? 'unknown'}`);
      try {
        const session = await attachToTarget(candidate, timeoutMs);
        const hasApp = await waitForCondition(
          'app element',
          () => session.evaluate(() => Boolean(document.getElementById('app'))),
          3000
        ).then(() => true, () => false);
        if (hasApp) {
          console.log(`UI E2E: attached to target (${candidate.type ?? 'unknown'}) ${candidate.url ?? 'unknown'}`);
          return session;
        }
        await session.close();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const hintLabel = targetHint ? JSON.stringify(targetHint) : 'none';
  if (lastError) {
    throw new Error(`Unable to attach to OpenHands webview (hint=${hintLabel}). Last error: ${lastError.message}`);
  }
  throw new Error(`Unable to attach to OpenHands webview (hint=${hintLabel}).`);

  function attachToTarget(target: CdpTarget, timeoutMs: number): Promise<WebviewSession> {
    return (async () => {
      const client = await CdpClient.connect(target.webSocketDebuggerUrl!, timeoutMs);
      try {
        await client.send('Runtime.enable');
        await client.send('Page.enable');
        const frameTree = await client.send('Page.getFrameTree');
        const frameIds = collectFrameIds(frameTree);
        let matched = false;
        for (const frameId of frameIds) {
          try {
            const world = await client.send('Page.createIsolatedWorld', {
              frameId,
              worldName: 'openhands-e2e',
            });
            if (!world?.executionContextId) continue;
            client.setDefaultContext(world.executionContextId);
            const hasApp = await waitForCondition(
              'app element',
              () => client.evaluate(() => Boolean(document.getElementById('app'))),
              1000
            ).then(() => true, () => false);
            if (hasApp) {
              matched = true;
              break;
            }
          } catch {
            // ignore and try next frame
          }
        }
        if (!matched) {
          const frameId = findFrameId(frameTree, target.url ?? '');
          if (frameId) {
            await client.waitForFrameContext(frameId, timeoutMs);
          } else {
            await client.waitForDefaultContext(timeoutMs);
          }
        }
      } catch (error) {
        await client.close();
        throw error;
      }

      const evaluate = <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) =>
        client.evaluate<T>(fn, ...args);

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
                appExists: Boolean(document.getElementById('app')),
                appChildCount: document.getElementById('app')?.childElementCount ?? 0,
                locationHref: window.location.href,
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
    })();
  }
}

async function getWebviewTargets(port: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<CdpTarget[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? (data as CdpTarget[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function pickWebviewTarget(targets: CdpTarget[], hint: WebviewTargetHint | null): CdpTarget[] {
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
  const byIndex = (list: CdpTarget[]) =>
    list.sort((a, b) => Number(Boolean(b.url?.includes('index.html'))) - Number(Boolean(a.url?.includes('index.html'))));

  return [...byIndex(iframeCandidates), ...byIndex(pageCandidates), ...byIndex(candidates)];
}

async function getWebviewCandidates(
  port: number,
  hint: WebviewTargetHint | null,
  timeoutMs: number
): Promise<CdpTarget[]> {
  const perRequestTimeoutMs = Math.min(timeoutMs, 5000);
  const targets = await getWebviewTargets(port, perRequestTimeoutMs);
  return pickWebviewTarget(targets, hint);
}

function findFrameId(frameTree: any, targetUrl: string): string | null {
  const root = frameTree?.frameTree ?? frameTree;
  if (!root) return null;

  const findByPredicate = (node: any, predicate: (url: string) => boolean): string | null => {
    const url = typeof node?.frame?.url === 'string' ? node.frame.url : '';
    if (url && predicate(url)) return node.frame.id ?? null;
    const children = Array.isArray(node?.childFrames) ? node.childFrames : [];
    for (const child of children) {
      const match = findByPredicate(child, predicate);
      if (match) return match;
    }
    return null;
  };

  if (targetUrl) {
    const exact = findByPredicate(root, (url) => url === targetUrl);
    if (exact) return exact;
    try {
      const target = new URL(targetUrl);
      const host = target.host;
      const pathname = target.pathname;
      const extensionId = target.searchParams.get('extensionId');
      const byHostPath = findByPredicate(root, (url) => {
        try {
          const candidate = new URL(url);
          if (host && candidate.host !== host) return false;
          if (pathname && candidate.pathname !== pathname) return false;
          if (extensionId && !candidate.searchParams.get('extensionId')?.includes(extensionId)) return false;
          return true;
        } catch {
          return false;
        }
      });
      if (byHostPath) return byHostPath;
    } catch {
      // ignore
    }
  }

  return root.frame?.id ?? null;
}

function collectFrameIds(frameTree: any): string[] {
  const root = frameTree?.frameTree ?? frameTree;
  const ids: string[] = [];
  if (!root) return ids;

  const visit = (node: any) => {
    const frameId = node?.frame?.id;
    if (typeof frameId === 'string') ids.push(frameId);
    const children = Array.isArray(node?.childFrames) ? node.childFrames : [];
    for (const child of children) {
      visit(child);
    }
  };

  visit(root);
  return ids;
}
