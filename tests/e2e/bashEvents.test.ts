import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `vscode-test-bash-events-${Date.now()}`);

// E2E test for bash events terminal integration
// This test verifies that bash events can be injected and trigger terminal creation
describe('OpenHands-Tab Bash Events E2E', function () {
  this.timeout(120000);

  it('injects bash events and creates terminal', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');

    // Point to the suite directory (not a specific file)
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        extensionDevelopmentPath,
        '--no-sandbox',
        '--user-data-dir', userDataDir,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer'
      ],
      extensionTestsEnv: {
        TEST_NAME: 'bashEvents'
      }
    });

    assert.ok(true);
  });
});
