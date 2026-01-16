import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('llmSwitching');

// E2E test for switching LLM provider/model/apiMode in local mode.
describe('OpenHands-Tab LLM Switching E2E', function () {
  this.timeout(180000);

  it('switches provider/model/apiMode during a conversation', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    // We override HOME/USERPROFILE for this suite to keep ~/.openhands/llm-profiles isolated.
    // VS Code also looks for runtime args in $HOME/.vscode/argv.json, and will show an error dialog if missing/invalid.
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
        extensionDevelopmentPath
      ],
      extensionTestsEnv: {
        TEST_NAME: 'llmSwitching',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: 'e2e-openai-key',
        ANTHROPIC_API_KEY: 'e2e-anthropic-key',
        OPENROUTER_API_KEY: 'e2e-openrouter-key',
        LITELLM_API_KEY: 'e2e-litellm-key',
        GEMINI_API_KEY: 'e2e-gemini-key',
      }
    });

    assert.ok(true);
  });
});
