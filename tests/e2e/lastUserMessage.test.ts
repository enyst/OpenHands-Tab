import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import * as os from 'os';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `vscode-t-lum-${Date.now()}`);

describe('OpenHands-Tab last user message diagnostics E2E', function () {
  this.timeout(120000);

  it('returns last user MessageEvent content vs extended_content', async () => {
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
        extensionDevelopmentPath,
      ],
      extensionTestsEnv: {
        TEST_NAME: 'lastUserMessage',
      },
    });

    assert.ok(true);
  });
});
