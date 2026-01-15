import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getEffectiveWorkspaceRoot, resolvePreferredWorkspaceRoot } from '../workspaceRoot';

describe('workspaceRoot helpers', () => {
  beforeEach(() => {
    (vscode as any).__resetMocks?.();
  });

  it('falls back to workspaceFolders[0] when no active editor', () => {
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }, { uri: { fsPath: '/test/workspace-b' } }];

    expect(resolvePreferredWorkspaceRoot()).toBe('/test/workspace-a');
    expect(getEffectiveWorkspaceRoot()).toBe('/test/workspace-a');
  });

  it('prefers the workspace folder containing the active editor', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }, { uri: { fsPath: '/test/workspace-b' } }];
    (vscode.workspace as any).getWorkspaceFolder = vi.fn((uri: { fsPath: string }) => {
      if (uri.fsPath.startsWith('/test/workspace-b/')) return { uri: { fsPath: '/test/workspace-b' } };
      if (uri.fsPath.startsWith('/test/workspace-a/')) return { uri: { fsPath: '/test/workspace-a' } };
      return undefined;
    });
    (vscode.window as any).activeTextEditor = { document: { uri: { fsPath: '/test/workspace-b/src/a.ts' } } };

    expect(resolvePreferredWorkspaceRoot()).toBe('/test/workspace-b');
    expect(getEffectiveWorkspaceRoot()).toBe('/test/workspace-b');
  });

  it('falls back to workspaceFolders[0] when active editor is outside all workspace folders', () => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }, { uri: { fsPath: '/test/workspace-b' } }];
    (vscode.workspace as any).getWorkspaceFolder = vi.fn(() => undefined);
    (vscode.window as any).activeTextEditor = { document: { uri: { fsPath: '/not/in/workspace/file.ts' } } };

    expect(resolvePreferredWorkspaceRoot()).toBe('/test/workspace-a');
    expect(getEffectiveWorkspaceRoot()).toBe('/test/workspace-a');
  });
});
