import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as path from 'path';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('llmProfiles');

describe('OpenHands-Tab LLM Profiles E2E', function () {
  this.timeout(180000);

  it('creates, updates, and switches LLM profiles', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    // Isolate ~/.openhands/llm-profiles + VS Code argv settings for this suite.
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
        TEST_NAME: 'llmProfiles',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: '',
        LLM_API_KEY: '',
        ANTHROPIC_API_KEY: 'e2e-anthropic-key',
      }
    });

    assert.ok(true);
  });
});
