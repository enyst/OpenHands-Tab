import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { listWorkspaceFiles } from '../workspaceFiles';

describe('listWorkspaceFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks?.();
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    (vscode.workspace as any).findFiles = vi.fn(async () => []);
    (vscode.workspace as any).asRelativePath = vi.fn((uri: { path?: string; fsPath?: string }) => uri.path ?? uri.fsPath ?? '');
  });

  it('returns empty when there is no workspace folder', async () => {
    (vscode.workspace as any).workspaceFolders = [];

    await expect(listWorkspaceFiles()).resolves.toEqual([]);
    expect((vscode.workspace as any).findFiles).not.toHaveBeenCalled();
  });

  it('deduplicates and sorts files', async () => {
    (vscode.workspace as any).findFiles = vi.fn(async () => [{ path: 'z.ts' }, { path: 'a.ts' }, { path: 'z.ts' }]);

    await expect(listWorkspaceFiles()).resolves.toEqual(['a.ts', 'z.ts']);
    expect((vscode.workspace as any).findFiles).toHaveBeenCalledTimes(1);
  });

  it('retries when the first file query is empty', async () => {
    (vscode.workspace as any).findFiles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ path: 'README.md' }]);

    await expect(listWorkspaceFiles()).resolves.toEqual(['README.md']);
    expect((vscode.workspace as any).findFiles).toHaveBeenCalledTimes(3);
  });
});
