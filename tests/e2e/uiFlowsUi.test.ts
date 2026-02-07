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
    const runTestsOverallStart = Date.now();
    let runTestsCompleted = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const port = await getAvailablePort();
      const attemptStart = Date.now();
      console.log(`[e2e/uiFlowsUi] runTests attempt ${attempt}/${maxAttempts} starting (cdp_port=${port})`);
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
        const now = Date.now();
        const attemptElapsedMs = now - attemptStart;
        const totalElapsedMs = now - runTestsOverallStart;
        console.log(
          `[e2e/uiFlowsUi] runTests attempt ${attempt}/${maxAttempts} succeeded in ${attemptElapsedMs}ms (total=${totalElapsedMs}ms)`
        );
        runTestsCompleted = true;
        break;
      } catch (error) {
        const attemptElapsedMs = Date.now() - attemptStart;
        const message = error instanceof Error ? error.message : String(error);
        const isPortConflict = /EADDRINUSE|address already in use|EADDRNOTAVAIL/i.test(message);
        console.warn(
          `[e2e/uiFlowsUi] runTests attempt ${attempt}/${maxAttempts} failed in ${attemptElapsedMs}ms (port_conflict=${isPortConflict})`
        );
        if (!isPortConflict || attempt === maxAttempts) {
          throw error;
        }
        console.warn(`UI E2E run failed due to port conflict (attempt ${attempt}/${maxAttempts}); retrying...`);
      }
    }
    if (!runTestsCompleted) {
      console.warn(
        `[e2e/uiFlowsUi] runTests did not complete after ${maxAttempts} attempts (elapsed=${Date.now() - runTestsOverallStart}ms)`
      );
    }

    assert.ok(true);
  });
});
