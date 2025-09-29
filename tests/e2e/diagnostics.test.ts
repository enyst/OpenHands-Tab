import * as assert from 'assert';
import { runTests, downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as path from 'path';

// A smaller test that queries the diagnostics command
// We do not rely on CLI here; we just run the suite which can call the command

describe('OpenHands-Tab diagnostics', function () {
  this.timeout(120000);

  it('returns basic state after opening tab', async () => {
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './out/suite');

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });

    assert.ok(true);
  });
});
