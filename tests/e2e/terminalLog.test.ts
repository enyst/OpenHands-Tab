import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `vscode-test-terminal-${Date.now()}`);

describe('OpenHands-Tab Terminal Log E2E', function () {
  this.timeout(120000);

  it('coalesces CR progress updates and renders exit code once', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

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
        TEST_NAME: 'terminalLog',
      }
    });

    assert.ok(true);
  });
});
