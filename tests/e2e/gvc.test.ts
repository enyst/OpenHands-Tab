import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-gvc-${Date.now().toString(36)}`);

describe('OpenHands-Tab watched-file notes E2E', function () {
  this.timeout(180000);

  it('queues watched-file notes into next LLM request extended_content', async () => {
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
        TEST_NAME: 'gvc',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: 'e2e-openai-key',
      },
    });

    assert.ok(true);
  });
});

