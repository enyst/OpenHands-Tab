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

    const port = await getAvailablePort();
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await ensureVsCodeArgvJson(userDataDir);

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

    assert.ok(true);
  });
});
