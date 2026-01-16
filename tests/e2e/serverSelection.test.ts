import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('serverSelection');

// E2E test for server selection and local/remote mode switching
describe('OpenHands-Tab Server Selection E2E', function () {
  this.timeout(120000);

  it('tests server selection and mode switching', async () => {
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
        TEST_NAME: 'serverSelection'
      }
    });

    assert.ok(true);
  });
});
