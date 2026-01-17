import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';
import { startMockLlmServer, type MockLlmScript } from './suite/mockLlmServer';

const userDataDir = createE2EUserDataDir('agentServerRemoteErrorHandling');
const agentServerStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-e2e-agent-server-'));
const agentServerConversationsPath = path.join(agentServerStateDir, 'conversations');
const agentServerBashEventsDir = path.join(agentServerStateDir, 'bash_events');
fs.mkdirSync(agentServerConversationsPath, { recursive: true });
fs.mkdirSync(agentServerBashEventsDir, { recursive: true });

function getDefaultAgentSdkDir(): string {
  return path.join(os.homedir(), 'repos', 'agent-sdk');
}

function resolveUvPath(): string | null {
  const found = spawnSync('which', ['uv'], { encoding: 'utf8' });
  const uvPath = typeof found.stdout === 'string' ? found.stdout.trim() : '';
  return uvPath.length > 0 ? uvPath : null;
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
  const min = 20_000;
  const max = 60_000;
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const port = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!triedPorts.has(port)) {
      triedPorts.add(port);
      return port;
    }
  }
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

describe('OpenHands-Tab Remote Agent-Server E2E (error handling)', function () {
  this.timeout(180000);

  it('renders an error event when the LLM endpoint returns 400', async function () {
    if (process.env.E2E_AGENT_SERVER !== '1') {
      this.skip();
    }

    const agentSdkDir = process.env.AGENT_SDK_DIR || process.env.OPENHANDS_AGENT_SDK_DIR || getDefaultAgentSdkDir();
    if (!agentSdkDir) this.skip();
    if (!fs.existsSync(agentSdkDir)) this.skip();
    const uvPath = resolveUvPath();
    if (!uvPath) this.skip();
    const uvCheck = spawnSync(uvPath, ['--version'], { stdio: 'ignore' });
    if (uvCheck.error || uvCheck.status !== 0) this.skip();

    const errorResponses = Array.from({ length: 25 }, () => ({
      type: 'json' as const,
      status: 400,
      body: { error: { message: 'E2E forced error', type: 'e2e_error' } },
    }));
    const scripts: MockLlmScript[] = [
      { path: '/chat/completions', responses: errorResponses },
      { path: '/responses', responses: errorResponses },
    ];

    const mock = await startMockLlmServer({ scripts });

    const env: Record<string, string | undefined> = {
      ...process.env,
      // Avoid tmux-based terminal sessions in E2E (tmux can be flaky / unavailable in CI).
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      PYTHONUNBUFFERED: '1',
      OH_ENABLE_VSCODE: '0',
      OH_ENABLE_VNC: '0',
      OH_PRELOAD_TOOLS: '0',
      // Use an isolated state dir so the test run doesn't pick up corrupted/stale
      // conversations in ~/repos/agent-sdk/workspace/conversations.
      OH_CONVERSATIONS_PATH: agentServerConversationsPath,
      OH_BASH_EVENTS_DIR: agentServerBashEventsDir,
      // Make the default LLM config point at the mock server even if the client omits fields.
      LLM_MODEL: 'gpt-4o-mini',
      LLM_BASE_URL: `${mock.baseUrl}/v1`,
      // LiteLLM expects provider-specific env vars when api_key isn't explicitly provided
      // in the StartConversation payload.
      OPENAI_API_KEY: 'sk-e2e',
    };
    if (env.SESSION_API_KEY === undefined) {
      env.SESSION_API_KEY = '';
    }

    const { child, serverUrl, output } = await (async () => {
      // Inline wrapper so we can spawn uv by absolute path.
      const failures: string[] = [];
      const triedPorts = new Set<number>();
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const port = pickPortForAgentServer(triedPorts);
        const candidateUrl = `http://127.0.0.1:${port}`;
        const outputTail = createOutputTail();
        const childProc = spawn(
          uvPath,
          ['run', 'python', '-m', 'openhands.agent_server', '--host', '127.0.0.1', '--port', String(port)],
          {
            cwd: agentSdkDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
          }
        );
        childProc.stdout?.on('data', outputTail.append);
        childProc.stderr?.on('data', outputTail.append);
        try {
          await waitForHealthOrExit(childProc, `${candidateUrl}/health`, 45000);
          return { child: childProc, serverUrl: candidateUrl, output: outputTail };
        } catch (err) {
          failures.push(`Attempt ${attempt}/3 (${candidateUrl}): ${String(err)}\n${outputTail.dump()}`);
          await killProcessTree(childProc);
        }
      }
      throw new Error(`Failed to start agent-server after 3 attempts.\n\n${failures.join('\n\n')}`);
    })();

    try {
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
          '--disable-software-rasterizer',
          extensionDevelopmentPath,
        ],
        extensionTestsEnv: {
          TEST_NAME: 'agentServerRemoteErrorHandling',
          AGENT_SERVER_URL: serverUrl,
          MOCK_LLM_BASE_URL: mock.baseUrl,
        },
      });

      assert.ok(true);
    } catch (err) {
      console.error('agent-server output (tail):\n', output.dump());
      throw err;
    } finally {
      await killProcessTree(child);
      await mock.close();
    }
  });
});
