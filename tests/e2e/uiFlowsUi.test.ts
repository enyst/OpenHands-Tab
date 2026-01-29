import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson, getAvailablePort } from './testHelpers';

const userDataDir = createE2EUserDataDir('uiFlowsUi');

describe('OpenHands-Tab UI Flows (Playwright) E2E', function () {
  this.timeout(180000);

  it('tests key UI flows with real clicks', async function () {
    if (process.env.E2E_UI !== '1') {
      this.skip();
      return;
    }

    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await ensureVsCodeArgvJson(userDataDir);

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const port = await getAvailablePort();
      try {
        await runTests({
          vscodeExecutablePath,
          extensionDevelopmentPath,
          extensionTestsPath,
          launchArgs: [
            '--no-sandbox',
            '--user-data-dir', userDataDir,
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer',
            `--remote-debugging-port=${port}`,
            extensionDevelopmentPath,
          ],
          extensionTestsEnv: {
            TEST_NAME: 'uiFlowsUi',
            E2E_MOCK_ATTACHMENTS: '1',
            E2E_UI: '1',
            E2E_CDP_PORT: String(port),
          },
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isPortConflict = /EADDRINUSE|address already in use|EADDRNOTAVAIL/i.test(message);
        if (!isPortConflict || attempt === maxAttempts) {
          throw error;
        }
        console.warn(`UI E2E run failed due to port conflict (attempt ${attempt}/${maxAttempts}); retrying...`);
      }
    }

    assert.ok(true);
  });
});
