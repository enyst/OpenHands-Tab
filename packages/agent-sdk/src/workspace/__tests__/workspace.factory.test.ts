import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppleWorkspace, LocalWorkspace, RemoteWorkspace, Workspace } from '..';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('Workspace() factory', () => {
  it('creates a local workspace by default', () => {
    const ws = Workspace();
    expect(ws.kind).toBe('local');
    expect(ws).toBeInstanceOf(LocalWorkspace);
  });

  it('creates a local workspace when kind is omitted but root is provided', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-factory-'));
    created.push(root);
    const ws = Workspace({ root });
    expect(ws.kind).toBe('local');
    expect(ws).toBeInstanceOf(LocalWorkspace);
  });

  it('creates a remote workspace when kind=remote', () => {
    const ws = Workspace({ kind: 'remote', serverUrl: 'http://example.com', workingDir: '/workspace/project' });
    expect(ws.kind).toBe('remote');
    expect(ws).toBeInstanceOf(RemoteWorkspace);
  });

  it('creates an apple workspace when kind=apple', () => {
    const ws = Workspace({ kind: 'apple', hostPort: 3100, serverImage: 'smolpaws-agent-server:dev', root: '/workspace/project' });
    expect(ws.kind).toBe('apple');
    expect(ws).toBeInstanceOf(AppleWorkspace);
  });
});
