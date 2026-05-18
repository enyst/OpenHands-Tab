import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalWorkspace } from '..';

describe('LocalWorkspace VS Code workspace roots', () => {
  const created: string[] = [];

  beforeEach(() => {
    (globalThis as any).vscode = { workspace: { workspaceFolders: [] } };
  });

  afterEach(async () => {
    await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
    created.length = 0;
    delete (globalThis as any).vscode;
  });

  it('treats vscode-remote workspace folders as allowed roots', async () => {
    const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-base-'));
    const remoteDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-remote-'));
    created.push(baseDir, remoteDir);

    (globalThis as any).vscode.workspace.workspaceFolders = [{ uri: { scheme: 'vscode-remote', fsPath: remoteDir } }];

    const workspace = new LocalWorkspace(baseDir);
    expect(() => workspace.resolvePath(path.join(remoteDir, 'hello.txt'))).not.toThrow();
  });

  it('resolves absolute paths even when non-file-backed workspace folders are present', async () => {
    const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-base-'));
    const otherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-other-'));
    created.push(baseDir, otherDir);

    (globalThis as any).vscode.workspace.workspaceFolders = [{ uri: { scheme: 'untitled', fsPath: otherDir } }];

    const workspace = new LocalWorkspace(baseDir);
    expect(() => workspace.resolvePath(path.join(otherDir, 'hello.txt'))).not.toThrow();
  });
});
