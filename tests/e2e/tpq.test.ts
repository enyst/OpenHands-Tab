import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = path.join(os.tmpdir(), `oh-tab-tpq-${Date.now().toString(36)}`);

describe('OpenHands-Tab multi-root env-info workspaceRoot E2E', function () {
  this.timeout(180000);

  it('uses the active editor’s workspace folder as workspaceRoot', async () => {
    const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite');

    await ensureVsCodeArgvJson(userDataDir);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-tpq-'));
    const folderA = path.join(tmpRoot, 'A');
    const folderB = path.join(tmpRoot, 'B');
    await fs.mkdir(folderA, { recursive: true });
    await fs.mkdir(folderB, { recursive: true });

    const activeFile = path.join(folderB, 'foo.md');
    await fs.writeFile(activeFile, '# tpq\n', 'utf8');

    const workspaceFile = path.join(tmpRoot, 'tpq.code-workspace');
    await fs.writeFile(
      workspaceFile,
      JSON.stringify({ folders: [{ path: folderA }, { path: folderB }] }, null, 2),
      'utf8',
    );

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
        `--file-uri=${pathToFileURL(workspaceFile).toString()}`,
      ],
      extensionTestsEnv: {
        TEST_NAME: 'tpq',
        HOME: userDataDir,
        USERPROFILE: userDataDir,
        OPENAI_API_KEY: 'e2e-openai-key',
        E2E_TPQ_FOLDER_A: folderA,
        E2E_TPQ_FOLDER_B: folderB,
        E2E_TPQ_ACTIVE_FILE: activeFile,
      },
    });

    assert.ok(true);
  });
});
