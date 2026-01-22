import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { createE2EUserDataDir, downloadVSCodeWithRetry, ensureVsCodeArgvJson } from './testHelpers';

const userDataDir = createE2EUserDataDir('agentServerRemoteCloudBootstrap');
const agentServerStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-e2e-agent-server-'));
const agentServerConversationsPath = path.join(agentServerStateDir, 'conversations');
const agentServerBashEventsDir = path.join(agentServerStateDir, 'bash_events');
fs.mkdirSync(agentServerConversationsPath, { recursive: true });
fs.mkdirSync(agentServerBashEventsDir, { recursive: true });

function getDefaultAgentSdkDir(): string {
  return path.join(os.homedir(), 'repos', 'agent-sdk');
}

function resolveUvPath(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(cmd, ['uv'], { encoding: 'utf8' });
  if (found.error || found.status !== 0) {
    return null;
  }
  const stdout = typeof found.stdout === 'string' ? found.stdout.trim() : '';
  const firstLine = stdout.split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine.length > 0 ? firstLine : null;
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { method: 'GET', signal: controller.signal }).finally(() => clearTimeout(timer));
      // Agent-server may not expose a dedicated health endpoint; any HTTP response indicates
      // the process is accepting connections.
      if (res.status < 500) return;
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
    // ignore
  }
  await waitForExit(2000);
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ignore
  }
  await waitForExit(2000);
}

async function startAgentServerWithRetry(
  agentSdkDir: string,
  uvPath: string,
  env: Record<string, string | undefined>,
  maxAttempts: number = 3
): Promise<{ child: ReturnType<typeof spawn>; serverUrl: string; output: OutputTail }> {
  const failures: string[] = [];
  const triedPorts = new Set<number>();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const port = pickPortForAgentServer(triedPorts);
    const serverUrl = `http://127.0.0.1:${port}`;
    const healthUrl = `${serverUrl}/api/health`;
    const output = createOutputTail();

    const child = spawn(
      uvPath,
      ['run', 'python', '-m', 'openhands.agent_server', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: agentSdkDir,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.stdout?.on('data', (b: Buffer) => output.append(b));
    child.stderr?.on('data', (b: Buffer) => output.append(b));

    try {
      await waitForHealthOrExit(child, healthUrl, 30000);
      return { child, serverUrl, output };
    } catch (err) {
      failures.push(`Attempt ${attempt} failed: ${String(err)}\n\n${output.dump()}`);
      await killProcessTree(child);
    }
  }

  throw new Error(`Failed to start agent-server after ${maxAttempts} attempts.\n\n${failures.join('\n\n')}`);
}

type MockSaasInspect = {
  streamStartAuth?: string;
  streamStartSawSessionHeader?: boolean;
  getAuth?: string;
  getSawSessionHeader?: boolean;
};

async function startMockSaasServer(params: {
  cloudApiKey: string;
  runtimeSessionApiKey: string;
  agentServerUrl: string;
}): Promise<{ url: string; close: () => Promise<void>; inspect: () => MockSaasInspect }> {
  const state: {
    appConversationId?: string;
    conversationUrl?: string;
    inspect: MockSaasInspect;
  } = { inspect: {} };

  const createConversationOnAgentServer = async (): Promise<string> => {
    const res = await fetch(`${params.agentServerUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-API-Key': params.runtimeSessionApiKey,
      },
      body: JSON.stringify({
        agent: { llm: { model: 'gpt-4o-mini' }, tools: [] },
        workspace: { kind: 'LocalWorkspace', working_dir: path.join(agentServerStateDir, 'workspace') },
        max_iterations: 1,
      }),
    });
    const json = await res.json().catch(() => ({})) as { id?: string; conversation_id?: string; uuid?: string };
    const id = (json.id || json.conversation_id || json.uuid || '').trim();
    if (!id) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Mock SaaS failed to create conversation on agent-server (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return id;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/api/v1/app-conversations/stream-start') {
        const auth = req.headers.authorization ?? '';
        state.inspect.streamStartAuth = typeof auth === 'string' ? auth : String(auth);
        state.inspect.streamStartSawSessionHeader = req.headers['x-session-api-key'] !== undefined;
        if (auth !== `Bearer ${params.cloudApiKey}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'invalid_token' }));
          return;
        }
        const conversationId = await createConversationOnAgentServer();
        const appConversationId = `app_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
        state.appConversationId = appConversationId;
        state.conversationUrl = `${params.agentServerUrl}/api/conversations/${conversationId}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ status: 'READY', app_conversation_id: appConversationId }]));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/app-conversations') {
        const auth = req.headers.authorization ?? '';
        state.inspect.getAuth = typeof auth === 'string' ? auth : String(auth);
        state.inspect.getSawSessionHeader = req.headers['x-session-api-key'] !== undefined;
        if (auth !== `Bearer ${params.cloudApiKey}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'invalid_token' }));
          return;
        }
        const ids = url.searchParams.getAll('ids');
        if (!ids.length || !state.appConversationId || ids[0] !== state.appConversationId) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify([null]));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{
          conversation_url: state.conversationUrl,
          session_api_key: params.runtimeSessionApiKey,
        }]));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/__inspect') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.inspect));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not_found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock SaaS failed to bind');
  }
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    inspect: () => ({ ...state.inspect }),
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    }
  };
}

describe('OpenHands-Tab Cloud Remote E2E (mock SaaS V1 + runtime key)', function () {
  this.timeout(240000);

  after(async () => {
    await fs.promises.rm(agentServerStateDir, { recursive: true, force: true });
  });

  it('bootstraps via SaaS V1 and connects to nested runtime agent-server with runtime session key', async function () {
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

    const runtimeKey = 'e2e-runtime-session-key';
    const cloudKey = 'e2e-cloud-api-key';

    const env: Record<string, string | undefined> = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      OH_ENABLE_VSCODE: '0',
      OH_ENABLE_VNC: '0',
      OH_PRELOAD_TOOLS: '0',
      OH_CONVERSATIONS_PATH: agentServerConversationsPath,
      OH_BASH_EVENTS_DIR: agentServerBashEventsDir,
      SESSION_API_KEY: runtimeKey,
    };
    if (process.platform !== 'win32') {
      env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    }

    const { child, serverUrl, output } = await startAgentServerWithRetry(agentSdkDir, uvPath, env, 3);
    const mockSaas = await startMockSaasServer({ cloudApiKey: cloudKey, runtimeSessionApiKey: runtimeKey, agentServerUrl: serverUrl });

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
          extensionDevelopmentPath
        ],
        extensionTestsEnv: {
          TEST_NAME: 'agentServerRemoteCloudBootstrap',
          MOCK_SAAS_URL: mockSaas.url,
          CLOUD_API_KEY: cloudKey,
          E2E_CLOUD_LOGIN: '1',
          OPENHANDS_CLOUD_HOSTNAMES: '127.0.0.1,localhost',
        }
      });

      const inspect = mockSaas.inspect();
      assert.strictEqual(inspect.streamStartAuth, `Bearer ${cloudKey}`);
      assert.strictEqual(inspect.getAuth, `Bearer ${cloudKey}`);
      assert.strictEqual(inspect.streamStartSawSessionHeader, false);
      assert.strictEqual(inspect.getSawSessionHeader, false);
    } catch (err) {
      console.error('agent-server output (tail):\n', output.dump());
      throw err;
    } finally {
      await mockSaas.close().catch(() => {});
      await killProcessTree(child);
    }
  });
});
