import * as assert from 'assert';
import { runTests, downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirnameE = path.dirname(__filename);
const userDataDir = path.join(os.tmpdir(), `vscode-test-${Date.now()}`);

// Basic E2E: launch VS Code with the extension and ensure commands run without error.
describe('OpenHands-Tab E2E', function () {
  this.timeout(180000);

  it('opens the tab and executes commands', async () => {
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    const extensionDevelopmentPath = path.resolve(__dirnameE, '../../');
    const extensionTestsPath = path.resolve(__dirnameE, './out/suite');

    // Log VS Code version via CLI (best-effort)
    cp.spawnSync(cliPath, ['--version'], { stdio: 'inherit', cwd: path.dirname(cliPath) });

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions',
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
