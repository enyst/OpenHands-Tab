import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-default-profile-${Date.now().toString(36)}`);

describe('OpenHands-Tab default profile selection E2E', function () {
  this.timeout(180000);

  after(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it('defaults profileId on fresh install and uses profile config', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    // Isolate ~/.openhands/llm-profiles + VS Code argv settings for this suite.
    await fs.mkdir(path.join(userDataDir, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(userDataDir, '.vscode', 'argv.json'), '{}\n', 'utf8');

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--no-sandbox',
        '--user-data-dir',
        userDataDir,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--use-inmemory-secretstorage',
        '--disable-software-rasterizer',
        extensionDevelopmentPath,
      ],
      extensionTestsEnv: {
        TEST_NAME: 'defaultProfileSelection',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: 'e2e-anthropic-key',
        GEMINI_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    });

    assert.ok(true);
  });
});
