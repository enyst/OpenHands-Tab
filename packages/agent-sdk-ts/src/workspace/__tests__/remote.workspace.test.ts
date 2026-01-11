import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteWorkspace } from '..';

const okJson = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => '',
});

const okBytes = (bytes: Uint8Array) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  text: async () => '',
});

describe('RemoteWorkspace', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    (globalThis as any).fetch = undefined;
  });

  it('rejects path traversal outside the working dir', () => {
    const ws = new RemoteWorkspace({ host: 'http://localhost:3000', workingDir: '/workspace/project' });
    expect(() => ws.resolvePath('../etc/passwd')).toThrowError(/Path escapes workspace root/i);
    expect(() => ws.resolvePath('/etc/passwd')).toThrowError(/Path escapes workspace root/i);
  });

  it('executes commands via bash endpoints and returns a CommandResult', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/api/bash/start_bash_command')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body.command).toBe('echo hello');
        expect(body.cwd).toBe('/workspace/project');
        expect(body.timeout).toBe(1);
        return okJson({ id: 'cmd-1' }) as any;
      }

      if (url.includes('/api/bash/bash_events/search')) {
        expect(url).toContain('command_id__eq=cmd-1');
        return okJson({
          items: [
            {
              kind: 'BashOutput',
              stdout: 'hello\n',
              stderr: '',
              exit_code: 0,
            },
          ],
          next_page_id: null,
        }) as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const ws = new RemoteWorkspace({
      host: 'http://localhost:3000',
      workingDir: '/workspace/project',
      apiKey: 'session-key',
      pollIntervalMs: 0,
    });

    const result = await ws.runCommand('echo hello', { timeoutMs: 1000 });
    expect(result.exitCode).toBe(0);
    expect(result.timeoutOccurred).toBe(false);
    expect(result.stdout).toBe('hello\n');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('downloads file bytes via /api/file/download', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/api/file/download//workspace/project/hello.txt');
      return okBytes(new TextEncoder().encode('hi')) as any;
    });
    (globalThis as any).fetch = fetchMock;

    const ws = new RemoteWorkspace({ host: 'http://localhost:3000', workingDir: '/workspace/project' });
    const buf = await ws.readFileBytes('hello.txt');
    expect(buf.toString('utf8')).toBe('hi');
  });
});
