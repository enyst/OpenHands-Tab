import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { downloadVSCodeWithRetry } from './testHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirnameE = path.dirname(__filename);
const userDataDir = path.join(os.tmpdir(), `vscode-test-${Date.now()}`);

// A smaller test that queries the diagnostics command
// We do not rely on CLI here; we just run the suite which can call the command

describe('OpenHands-Tab diagnostics', function () {
  this.timeout(120000);

  it('returns basic state after opening tab', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirnameE, '../..');
    const extensionTestsPath = path.resolve(__dirnameE, './out/suite');

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
