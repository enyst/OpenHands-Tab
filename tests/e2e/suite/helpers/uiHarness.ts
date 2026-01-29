import { chromium, type Browser, type Frame, type Page } from 'playwright-core';

type CdpTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForValue<T>(label: string, getter: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await getter();
    if (last !== undefined && last !== null) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

export async function connectToVsCodeUi(options: { port: number; timeoutMs?: number; webviewSelector?: string }): Promise<{
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
  waitForWebviewFrame: (timeoutOverride?: number) => Promise<Frame>;
}> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.port}`);
  const extraBrowsers: Browser[] = [];
  const extensionId = 'openhands.openhands-tab';
  let cachedWebviewFrame: Frame | null = null;

  const context = await waitForValue('browser context', () => browser.contexts()[0], timeoutMs);
  const page = await waitForValue('VS Code page', () => {
    const pages = context.pages();
    return pages.find((p) => p.url().includes('vscode')) ?? pages[0];
  }, timeoutMs);

  await page.bringToFront();

  return {
    browser,
    page,
    close: async () => {
      for (const extra of extraBrowsers) {
        await extra.close();
      }
      await browser.close();
    },
    waitForWebviewFrame: async (timeoutOverride?: number) => {
      if (cachedWebviewFrame) return cachedWebviewFrame;
      const timeout = timeoutOverride ?? timeoutMs;
      const deadline = Date.now() + timeout;
      let lastCdpError: Error | null = null;
      if (options.webviewSelector) {
        try {
          await page.locator(options.webviewSelector).first().waitFor({ state: 'attached', timeout });
        } catch {
          // fall through to frame discovery
        }
      }
      while (Date.now() < deadline) {
        const pages = browser.contexts().flatMap((context) => context.pages());
        const webviewPage = pages.find((candidate) => candidate.url().includes(extensionId));
        if (webviewPage) {
          cachedWebviewFrame = webviewPage.mainFrame();
          return cachedWebviewFrame;
        }
        for (const candidate of pages) {
          const frame = candidate.frames().find((f) => f.url().includes(extensionId));
          if (frame) return frame;
        }
        await sleep(200);
        const webviewTarget = await waitForWebviewTarget(options.port, extensionId, 500);
        if (webviewTarget?.webSocketDebuggerUrl) {
          try {
            const webviewBrowser = await chromium.connectOverCDP(webviewTarget.webSocketDebuggerUrl);
            extraBrowsers.push(webviewBrowser);
            const webviewContext = await waitForValue('webview context', () => webviewBrowser.contexts()[0], timeout);
            const webviewPageAttached = await waitForValue(
              'webview page',
              () => webviewContext.pages().find((candidate) => candidate.url().includes(extensionId)) ?? webviewContext.pages()[0],
              timeout,
            );
            cachedWebviewFrame = webviewPageAttached.mainFrame();
            return cachedWebviewFrame;
          } catch (error) {
            lastCdpError = error instanceof Error ? error : new Error(String(error));
          }
        }
      }

      const pages = browser.contexts().flatMap((context) => context.pages());
      const frameUrls = pages.flatMap((candidate) => candidate.frames().map((frame) => frame.url()));
      const pageUrls = pages.map((candidate) => candidate.url());
      const targets = await getWebviewTargets(options.port);
      const targetUrls = targets.map((target) => `${target.type ?? 'unknown'}:${target.url ?? 'unknown'}`);
      throw new Error(
        `Timed out waiting for OpenHands webview frame. Pages: ${pageUrls.join(' | ')}. ` +
          `Frames: ${frameUrls.join(' | ')}. Targets: ${targetUrls.join(' | ')}.` +
          (lastCdpError ? ` Last CDP error: ${lastCdpError.message}` : ''),
      );
    },
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
    await sleep(200);
  }
  return null;
}
