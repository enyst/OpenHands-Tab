import * as assert from 'assert';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirnameE = path.dirname(__filename);
const userDataDir = path.join(os.tmpdir(), `vscode-test-agent-sdk-${Date.now()}`);

// E2E test for agent-sdk event rendering in the webview
// This test exercises all event types from the agent-sdk conversation visualizer
describe('OpenHands-Tab Agent-SDK Events E2E', function () {
  this.timeout(120000);

  it('renders all agent-sdk event types in webview', async () => {
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const extensionDevelopmentPath = path.resolve(__dirnameE, '../..');

    // Point to the agentSdkEvents suite
    const extensionTestsPath = path.resolve(__dirnameE, './out/suite/agentSdkEvents.js');

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--no-sandbox',
        '--user-data-dir', userDataDir,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer'
      ],
    });

    assert.ok(true);
  });
});
