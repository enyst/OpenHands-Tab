import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { collectEnvironmentInfo } from '../collectEnvironmentInfo';

describe('collectEnvironmentInfo', () => {
  beforeEach(() => {
    (vscode as any).__resetMocks?.();
  });

  it('collects workspaceRoot, active editor path, and open editor paths', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }, { uri: { fsPath: '/test/workspace-b' } }];
    (vscode.workspace as any).getWorkspaceFolder = vi.fn((uri: { fsPath: string }) => {
      if (uri.fsPath.startsWith('/test/workspace-b/')) return { uri: { fsPath: '/test/workspace-b' } };
      if (uri.fsPath.startsWith('/test/workspace-a/')) return { uri: { fsPath: '/test/workspace-a' } };
      return undefined;
    });

    (vscode.window as any).activeTextEditor = {
      document: { uri: { scheme: 'file', fsPath: '/test/workspace-b/src/a.ts' } },
    };
    (vscode.window as any).visibleTextEditors = [
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace-b/src/a.ts' } } },
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace-b/src/b.ts' } } },
    ];

    expect(collectEnvironmentInfo()).toEqual({
      workspaceRoot: '/test/workspace-b',
      activeEditorPath: '/test/workspace-b/src/a.ts',
      openEditorPaths: ['/test/workspace-b/src/b.ts'],
    });
  });

  it('treats untitled active editor as no active path', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }];
    (vscode.workspace as any).getWorkspaceFolder = vi.fn(() => undefined);
    (vscode.window as any).activeTextEditor = {
      document: { uri: { scheme: 'untitled', fsPath: '/tmp/Untitled-1' } },
    };
    (vscode.window as any).visibleTextEditors = [
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace-a/src/b.ts' } } },
    ];

    expect(collectEnvironmentInfo()).toEqual({
      workspaceRoot: '/test/workspace-a',
      activeEditorPath: null,
      openEditorPaths: ['/test/workspace-a/src/b.ts'],
    });
  });

  it('treats vscode-remote active editor as file-backed', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }];
    (vscode.workspace as any).getWorkspaceFolder = vi.fn((uri: { fsPath: string }) => {
      if (uri.fsPath.startsWith('/test/workspace-a/')) return { uri: { fsPath: '/test/workspace-a' } };
      return undefined;
    });

    (vscode.window as any).activeTextEditor = {
      document: { uri: { scheme: 'vscode-remote', fsPath: '/test/workspace-a/src/remote.ts' } },
    };
    (vscode.window as any).visibleTextEditors = [
      { document: { uri: { scheme: 'vscode-remote', fsPath: '/test/workspace-a/src/remote.ts' } } },
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace-a/src/other.ts' } } },
    ];

    expect(collectEnvironmentInfo()).toEqual({
      workspaceRoot: '/test/workspace-a',
      activeEditorPath: '/test/workspace-a/src/remote.ts',
      openEditorPaths: ['/test/workspace-a/src/other.ts'],
    });
  });

  it('handles no workspace root and no active editor', () => {
    (vscode.workspace as any).workspaceFolders = [];
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.window as any).visibleTextEditors = [];

    expect(collectEnvironmentInfo()).toEqual({
      workspaceRoot: undefined,
      activeEditorPath: null,
      openEditorPaths: [],
    });
  });
});
