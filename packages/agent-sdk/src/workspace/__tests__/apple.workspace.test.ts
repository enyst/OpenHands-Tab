import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

describe('AppleWorkspace', () => {
  const originalEnvValue = process.env.APPLE_WORKSPACE_TEST_TOKEN;

  beforeEach(() => {
    spawnMock.mockReset();
    process.env.APPLE_WORKSPACE_TEST_TOKEN = 'secret-token';
    process.env.APPLE_WORKSPACE_EMPTY_TOKEN = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (typeof originalEnvValue === 'string') {
      process.env.APPLE_WORKSPACE_TEST_TOKEN = originalEnvValue;
    } else {
      delete process.env.APPLE_WORKSPACE_TEST_TOKEN;
    }
    delete process.env.APPLE_WORKSPACE_EMPTY_TOKEN;
  });

  it('builds Apple Container args from the workspace config', async () => {
    const { AppleWorkspace } = await import('..');

    const workspace = new AppleWorkspace({
      root: '/workspace/project',
      hostPort: 3100,
      serverImage: 'smolpaws-agent-server:dev',
      startupCommand: ['node', '/app/dist/runner.js', '--port', '8000'],
      volumes: [
        { hostPath: '/Users/enyst/repos/demo', containerPath: '/workspace/project' },
        { hostPath: '/Users/enyst/.config/smolpaws', containerPath: '/workspace/config', readonly: true },
      ],
      forwardEnv: ['APPLE_WORKSPACE_TEST_TOKEN'],
    });

    expect((workspace as unknown as { buildContainerArgs: () => string[] }).buildContainerArgs()).toEqual(
      [
        'run',
        '--rm',
        '-p',
        '3100:8000',
        '-v',
        '/Users/enyst/repos/demo:/workspace/project',
        '--mount',
        'type=bind,source=/Users/enyst/.config/smolpaws,target=/workspace/config,readonly',
        '-e',
        'APPLE_WORKSPACE_TEST_TOKEN=secret-token',
        'smolpaws-agent-server:dev',
        'node',
        '/app/dist/runner.js',
        '--port',
        '8000',
      ],
    );
  });

  it('attaches to an existing server url without spawning a container', async () => {
    const { AppleWorkspace } = await import('..');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const workspace = new AppleWorkspace({
      serverUrl: 'http://127.0.0.1:3200',
      root: '/workspace/project',
    });

    await expect(workspace.isAlive()).resolves.toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips empty forwarded env values', async () => {
    const { AppleWorkspace } = await import('..');

    const workspace = new AppleWorkspace({
      root: '/workspace/project',
      hostPort: 3100,
      serverImage: 'smolpaws-agent-server:dev',
      startupCommand: ['node', '/app/dist/runner.js', '--port', '8000'],
      forwardEnv: ['APPLE_WORKSPACE_TEST_TOKEN', 'APPLE_WORKSPACE_EMPTY_TOKEN'],
    });

    const args = (workspace as unknown as { buildContainerArgs: () => string[] }).buildContainerArgs();
    expect(args).toContain('APPLE_WORKSPACE_TEST_TOKEN=secret-token');
    expect(args).not.toContain('APPLE_WORKSPACE_EMPTY_TOKEN=');
  });
});
