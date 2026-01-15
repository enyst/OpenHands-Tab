import * as assert from 'assert';
import { runTests, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `vscode-test-${Date.now()}`);

// Basic E2E: launch VS Code with the extension and ensure commands run without error.
describe('OpenHands-Tab E2E', function () {
  this.timeout(180000);

  it('opens the chat view and executes commands', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    // Log VS Code version via CLI (best-effort)
    cp.spawnSync(cliPath, ['--version'], { stdio: 'inherit', cwd: path.dirname(cliPath) });

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
        extensionDevelopmentPath  // Open workspace folder to enable workspace settings
      ],
    });

    assert.ok(true);
  });
});
