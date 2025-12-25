import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { showWorkspaceDiff } from '../diffDocuments';

describe('showWorkspaceDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    (vscode.Uri.parse as any).mockImplementation((raw: string) => {
      const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
      const scheme = (match?.[1] ?? 'file').toLowerCase();
      return { scheme, fsPath: raw, toString: () => raw } as unknown as vscode.Uri;
    });

    (vscode.Uri.file as any).mockImplementation((fsPath: string) => {
      return { scheme: 'file', fsPath, toString: () => `file:${fsPath}` } as unknown as vscode.Uri;
    });
  });

  it('opens vscode.diff with a real file on the right-hand side', async () => {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    await showWorkspaceDiff({
      context,
      filePath: 'README.md',
      oldContent: 'old',
      newContent: 'new',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalled();
    const call = (vscode.commands.executeCommand as any).mock.calls.find((args: unknown[]) => args[0] === 'vscode.diff');
    expect(call).toBeTruthy();

    const [, beforeUri, afterUri] = call;
    expect(beforeUri.scheme).toBe('openhands-diff');
    expect(afterUri.scheme).toBe('file');
    expect(afterUri.fsPath).toBe('/test/workspace/README.md');
  });
});

