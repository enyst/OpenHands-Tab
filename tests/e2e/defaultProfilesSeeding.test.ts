import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-default-profiles-${Date.now().toString(36)}`);

describe('OpenHands-Tab default profiles seeding E2E', function () {
  this.timeout(180000);

  after(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true });
  });

  it('seeds default LLM profiles on first install and does not overwrite existing defaults', async () => {
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
        '--user-data-dir',
        userDataDir,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--use-inmemory-secretstorage',
        '--disable-software-rasterizer',
        extensionDevelopmentPath,
      ],
      extensionTestsEnv: {
        TEST_NAME: 'defaultProfilesSeeding',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
      },
    });

    assert.ok(true);
  });
});

