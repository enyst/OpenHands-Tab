import * as assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { downloadVSCodeWithRetry } from './testHelpers';

function getDefaultAgentSdkDir(): string {
  return path.join(os.homedir(), 'repos', 'agent-sdk');
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Failed to allocate free port')));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
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

function killProcessTree(proc: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    const pid = proc.pid;
    if (!pid) return resolve();

    const killSignal = 'SIGTERM' as const;
    try {
      if (process.platform !== 'win32') {
        process.kill(-pid, killSignal);
      } else {
        proc.kill(killSignal);
      }
    } catch {
      // ignore
    }

    const timeout = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
        else proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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

    const port = await getFreePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    const output: string[] = [];
    const child = spawn(
      'uv',
      ['run', 'python', '-m', 'openhands.agent_server', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: agentSdkDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1', SESSION_API_KEY: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      }
    );

    const append = (buf: Buffer) => {
      output.push(buf.toString('utf8'));
      // Keep a small tail for failure debugging
      if (output.join('').length > 20000) {
        output.splice(0, Math.max(0, output.length - 20));
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    try {
      await waitForHealth(`${serverUrl}/health`, 45000);

      const vscodeExecutablePath = await downloadVSCodeWithRetry('stable');
      const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
      const extensionTestsPath = path.resolve(__dirname, './suite');
      const userDataDir = path.join(os.tmpdir(), `vscode-test-agent-server-${Date.now()}`);

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
          TEST_NAME: 'agentServerRemote',
          AGENT_SERVER_URL: serverUrl,
        }
      });

      assert.ok(true);
    } catch (err) {
      console.error('agent-server output (tail):\n', output.join(''));
      throw err;
    } finally {
      await killProcessTree(child);
    }
  });
});
