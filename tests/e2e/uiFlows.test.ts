import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('uiFlows');

describe('OpenHands-Tab UI Flows E2E', function () {
  this.timeout(120000);

  it('tests context, skills, and attachments UI flows', async () => {
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
        extensionDevelopmentPath
      ],
      extensionTestsEnv: {
        TEST_NAME: 'uiFlows',
        E2E_MOCK_ATTACHMENTS: '1',
      }
    });

    assert.ok(true);
  });
});
