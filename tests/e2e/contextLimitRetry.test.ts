import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-0ph2-${Date.now().toString(36)}`);

describe('OpenHands-Tab context-limit condensation + retry E2E', function () {
  this.timeout(180000);

  it('condenses and retries after context_length_exceeded', async () => {
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
        '--use-inmemory-secretstorage',
        '--disable-software-rasterizer',
        extensionDevelopmentPath,
      ],
      extensionTestsEnv: {
        TEST_NAME: 'contextLimitRetry',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: 'e2e-openai-key',
      },
    });

    assert.ok(true);
  });
});

