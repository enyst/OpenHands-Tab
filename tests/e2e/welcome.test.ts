import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('welcome');

describe('OpenHands-Tab welcome missing-key prompts E2E', function () {
  this.timeout(180000);

  it('shows/hides prompts as keys change', async () => {
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
        TEST_NAME: 'welcome',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        OPENROUTER_API_KEY: '',
        LITELLM_API_KEY: '',
        GEMINI_API_KEY: '',
      },
    });

    assert.ok(true);
  });
});
