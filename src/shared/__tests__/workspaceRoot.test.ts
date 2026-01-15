import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getEffectiveWorkspaceRoot, resolvePreferredWorkspaceRoot } from '../workspaceRoot';

describe('workspaceRoot helpers', () => {
  beforeEach(() => {
    (vscode as any).__resetMocks?.();
    delete (globalThis as any).vscodeWorkspaceRoot;
  });

  it('falls back to workspaceFolders[0] when no active editor', () => {
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }, { uri: { fsPath: '/test/workspace-b' } }];

    expect(resolvePreferredWorkspaceRoot()).toBe('/test/workspace-a');
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
  });

  it('uses globalThis.vscodeWorkspaceRoot when set', () => {
    (globalThis as any).vscodeWorkspaceRoot = '/from/global';
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace-a' } }];

    expect(getEffectiveWorkspaceRoot()).toBe('/from/global');
  });
});

