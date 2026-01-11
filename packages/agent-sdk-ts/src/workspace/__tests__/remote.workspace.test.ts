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
    const commandId = '00000000-0000-0000-0000-000000000001';
    const event1Id = '00000000-0000-0000-0000-000000000002';
    const event2Id = '00000000-0000-0000-0000-000000000003';
    const ts1 = '2026-01-01T00:00:00Z';
    const ts2 = '2026-01-01T00:00:01Z';
    const pageId = '20260101000000_BashOutput_00000000000000000000000000000001_00000000000000000000000000000002';

    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/api/bash/start_bash_command')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body.command).toBe('echo hello');
        expect(body.cwd).toBe('/workspace/project');
        expect(body.timeout).toBe(1);
        return okJson({ id: commandId }) as any;
      }

      if (url.includes('/api/bash/bash_events/search')) {
        expect(url).toContain(`command_id__eq=${encodeURIComponent(commandId)}`);
        expect(url).toContain('kind__eq=BashOutput');

        if (!url.includes('page_id=')) {
          return okJson({
            items: [
              {
                kind: 'BashOutput',
                id: event1Id,
                timestamp: ts1,
                command_id: commandId,
                stdout: 'hello\n',
                stderr: '',
                exit_code: null,
              },
            ],
            next_page_id: null,
          }) as any;
        }

        expect(url).toContain(`page_id=${encodeURIComponent(pageId)}`);
        return okJson({
          items: [
            {
              kind: 'BashOutput',
              id: event1Id,
              timestamp: ts1,
              command_id: commandId,
              stdout: 'hello\n',
              stderr: '',
              exit_code: null,
            },
            {
              kind: 'BashOutput',
              id: event2Id,
              timestamp: ts2,
              command_id: commandId,
              stdout: 'done\n',
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
    expect(result.stdout).toBe('hello\ndone\n');

    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it('uploads file bytes via /api/file/upload on writeFile', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      expect(url).toContain('/api/file/upload/');
      expect(url).toContain('/workspace/project/hello.txt');
      expect(init?.method).toBe('POST');
      expect(init?.headers?.['X-Session-API-Key']).toBe('session-key');
      expect(init?.body).toBeInstanceOf(FormData);
      return okJson({ ok: true }) as any;
    });
    (globalThis as any).fetch = fetchMock;

    const ws = new RemoteWorkspace({
      host: 'http://localhost:3000',
      workingDir: '/workspace/project',
      apiKey: 'session-key',
    });

    await ws.writeFile('hello.txt', 'hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
