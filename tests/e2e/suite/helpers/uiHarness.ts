import { chromium, type Browser, type Frame, type Page } from 'playwright-core';

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
      await browser.close();
    },
    waitForWebviewFrame: async (timeoutOverride?: number) => {
      const timeout = timeoutOverride ?? timeoutMs;
      const deadline = Date.now() + timeout;
      if (options.webviewSelector) {
        try {
          await page.locator(options.webviewSelector).first().waitFor({ state: 'attached', timeout });
        } catch {
          // fall through to frame discovery
        }
      }
      while (Date.now() < deadline) {
        const pages = browser.contexts().flatMap((context) => context.pages());
        for (const candidate of pages) {
          const frame = candidate.frames().find((f) => f.url().includes('openhands.openhands-tab'));
          if (frame) return frame;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const pages = browser.contexts().flatMap((context) => context.pages());
      const urls = pages.flatMap((candidate) => candidate.frames().map((frame) => frame.url()));
      throw new Error(`Timed out waiting for OpenHands webview frame. Frames seen: ${urls.join(' | ')}`);
    },
  };
}
