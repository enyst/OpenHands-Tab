import { chromium, type Browser, type FrameLocator, type Page } from 'playwright-core';

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

export async function connectToVsCodeUi(options: { port: number; timeoutMs?: number }): Promise<{
  browser: Browser;
  page: Page;
  webview: FrameLocator;
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

  const webview = page.frameLocator('iframe.webview').first();
  await webview.locator('body').waitFor({ state: 'attached', timeout: timeoutMs });

  return {
    browser,
    page,
    webview,
    close: async () => {
      await browser.close();
    },
  };
}
