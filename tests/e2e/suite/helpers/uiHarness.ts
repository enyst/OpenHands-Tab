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

async function waitForFrame(label: string, getter: () => Frame | undefined, timeoutMs: number, page: Page): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = getter();
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const urls = page.frames().map((frame) => frame.url());
  throw new Error(`Timed out waiting for ${label}. Frames seen: ${urls.join(' | ')}`);
}

export async function connectToVsCodeUi(options: { port: number; timeoutMs?: number; webviewSelector?: string }): Promise<{
  browser: Browser;
  page: Page;
  webview: Frame;
  close: () => Promise<void>;
}> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.port}`);

  const context = await waitForValue('browser context', () => browser.contexts()[0], timeoutMs);
  const page = await waitForValue('VS Code page', () => {
    const pages = context.pages();
    return pages.find((p) => p.url().includes('vscode')) ?? pages[0];
  }, timeoutMs);

  await page.bringToFront();

  if (options.webviewSelector) {
    try {
      await page.locator(options.webviewSelector).first().waitFor({ state: 'attached', timeout: timeoutMs });
    } catch {
      // frame discovery below is the source of truth
    }
  }

  const webviewFrame = await waitForFrame(
    'OpenHands webview frame',
    () => page.frames().find((frame) => frame.url().includes('openhands.openhands-tab')),
    timeoutMs,
    page
  );

  return {
    browser,
    page,
    webview: webviewFrame,
    close: async () => {
      await browser.close();
    },
  };
}
