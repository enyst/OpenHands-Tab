import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { downloadVSCodeWithRetry } from './testHelpers';

function getDefaultAgentSdkDir(): string {
  return path.join(os.homedir(), 'repos', 'agent-sdk');
}

type OutputTail = {
  append: (buf: Buffer) => void;
  dump: () => string;
};

function createOutputTail(maxChars: number = 20000): OutputTail {
  const chunks: string[] = [];
  let length = 0;
  return {
    append: (buf: Buffer) => {
      const text = buf.toString('utf8');
      if (!text) return;
      chunks.push(text);
      length += text.length;
      while (length > maxChars && chunks.length > 1) {
        const removed = chunks.shift() ?? '';
        length -= removed.length;
      }
    },
    dump: () => chunks.join(''),
  };
}

function pickPortForAgentServer(triedPorts: Set<number>): number {
  // Avoid the bind+close+rebind race: pick a candidate port and retry on failure.
  // (Similar to how we now bind the mock LLM server to port 0.)
  const min = 20_000;
  const max = 60_000;
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const port = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!triedPorts.has(port)) {
      triedPorts.add(port);
      return port;
    }
  }
  // Extremely unlikely; just return a candidate.
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForHealthOrExit(proc: ReturnType<typeof spawn>, url: string, timeoutMs: number = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`Agent-server exited before reporting healthy (exit=${String(proc.exitCode)} signal=${String(proc.signalCode)})`);
    }
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for agent-server health at ${url}: ${String(lastError)}`);
}

async function killProcessTree(proc: ReturnType<typeof spawn>): Promise<void> {
  const pid = proc.pid;
  if (!pid) return;
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  const waitForExit = async (timeoutMs: number): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  if (process.platform === 'win32') {
    try {
      // Best effort: terminate the entire process tree.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
    await waitForExit(2000);
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  await waitForExit(2000);
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }

  await waitForExit(2000);
}

async function startAgentServerWithRetry(
  agentSdkDir: string,
  env: Record<string, string | undefined>,
  maxAttempts: number = 3
): Promise<{ child: ReturnType<typeof spawn>; serverUrl: string; output: OutputTail }> {
  const failures: string[] = [];
  const triedPorts = new Set<number>();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const port = pickPortForAgentServer(triedPorts);
    const serverUrl = `http://127.0.0.1:${port}`;
    const output = createOutputTail();
    const child = spawn(
      'uv',
      ['run', 'python', '-m', 'openhands.agent_server', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: agentSdkDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      }
    );

    child.stdout?.on('data', output.append);
    child.stderr?.on('data', output.append);

    try {
      await waitForHealthOrExit(child, `${serverUrl}/health`, 45000);
      return { child, serverUrl, output };
    } catch (err) {
      failures.push(`Attempt ${attempt}/${maxAttempts} (${serverUrl}): ${String(err)}\n${output.dump()}`);
      await killProcessTree(child);
    }
  }

  throw new Error(`Failed to start agent-server after ${maxAttempts} attempts.\n\n${failures.join('\n\n')}`);
}

describe('OpenHands-Tab Remote Agent-Server E2E', function () {
  this.timeout(180000);

  it('connects to a live python agent-server and streams events', async function () {
    if (process.env.E2E_AGENT_SERVER !== '1') {
      this.skip();
    }

    const agentSdkDir = process.env.AGENT_SDK_DIR || process.env.OPENHANDS_AGENT_SDK_DIR || getDefaultAgentSdkDir();
    if (!agentSdkDir) {
      this.skip();
    }
    if (!fs.existsSync(agentSdkDir)) {
      this.skip();
    }
    const uvCheck = spawnSync('uv', ['--version'], { stdio: 'ignore' });
    if (uvCheck.error || uvCheck.status !== 0) {
      this.skip();
    }

    const env: Record<string, string | undefined> = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      // Keep server startup lightweight for CI (no VSCode/VNC, no tool preload).
      OH_ENABLE_VSCODE: '0',
      OH_ENABLE_VNC: '0',
      OH_PRELOAD_TOOLS: '0',
    };
    if (env.SESSION_API_KEY === undefined) {
      // Default to no auth for CI, but allow authenticated runs by setting
      // SESSION_API_KEY in the environment.
      env.SESSION_API_KEY = '';
    }

    const { child, serverUrl, output } = await startAgentServerWithRetry(agentSdkDir, env, 3);

    try {
      const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
      const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
      const extensionTestsPath = path.resolve(__dirname, './suite');
      const userDataDir = path.join(os.tmpdir(), `vscode-test-agent-server-${Date.now()}`);

      // Isolate ~/.openhands/llm-profiles + VS Code argv settings for this suite.
      await fs.promises.mkdir(path.join(userDataDir, '.vscode'), { recursive: true });
      await fs.promises.writeFile(path.join(userDataDir, '.vscode', 'argv.json'), '{}\n', 'utf8');

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
          TEST_NAME: 'agentServerRemote',
          AGENT_SERVER_URL: serverUrl,
          HOME: userDataDir,
          USERPROFILE: userDataDir,
        }
      });

      assert.ok(true);
    } catch (err) {
      console.error('agent-server output (tail):\n', output.dump());
      throw err;
    } finally {
      await killProcessTree(child);
    }
  });
});
