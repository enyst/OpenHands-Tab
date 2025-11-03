import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `vscode-test-agent-sdk-${Date.now()}`);

// E2E test for agent-sdk event rendering in the webview
// This test exercises all event types from the agent-sdk conversation visualizer
describe('OpenHands-Tab Agent-SDK Events E2E', function () {
  this.timeout(120000);

  it('renders all agent-sdk event types in webview', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');

    // Point to the suite directory (not a specific file)
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
        extensionDevelopmentPath  // Open workspace folder to enable workspace settings
      ],
      extensionTestsEnv: {
        TEST_NAME: 'agentSdkEvents'
      }
    });

    assert.ok(true);
  });
});
