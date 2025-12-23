import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-llm-${Date.now().toString(36)}`);

// E2E test for switching LLM provider/model/apiMode in local mode.
describe('OpenHands-Tab LLM Switching E2E', function () {
  this.timeout(180000);

  it('switches provider/model/apiMode during a conversation', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
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
      }
    });

    assert.ok(true);
  });
});
