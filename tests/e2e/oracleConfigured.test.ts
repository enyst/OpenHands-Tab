import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { downloadVSCodeWithRetry } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-oracle-configured-${Date.now().toString(36)}`);

describe('OpenHands-Tab ask_oracle configured profile E2E', function () {
  this.timeout(180000);

  it('calls the configured oracle profile and returns the oracle answer', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await fs.mkdir(path.join(userDataDir, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(userDataDir, '.vscode', 'argv.json'), '{}\n', 'utf8');

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
        TEST_NAME: 'oracleConfigured',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
      },
    });

    assert.ok(true);
  });
});

