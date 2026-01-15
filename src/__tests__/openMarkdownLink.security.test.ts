import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';

describe('openMarkdownLink security rules', () => {
  let tmpDir = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-openMarkdownLink-'));

    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: tmpDir } }];
    (vscode.workspace as any).openTextDocument = vi.fn(async (uri: vscode.Uri) => ({ uri }));
    (vscode.window as any).showTextDocument = vi.fn(async () => ({}));

    (vscode.env.openExternal as any).mockImplementation(async () => true);

    (vscode.Uri.parse as any).mockImplementation((raw: string) => {
      const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
      const scheme = (match?.[1] ?? 'file').toLowerCase();
      return { fsPath: raw, scheme } as vscode.Uri;
    });
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  function createHandler() {
    return createWebviewMessageHandler({
      context: { globalStorageUri: { fsPath: tmpDir } } as any,
      host: { postMessage: vi.fn(async () => true) },
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => tmpDir,
      setWebviewReadyState: () => {},
      setLastKnownLlmLabel: () => {},
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => {},
      onRenderedEventsResponse: () => {},
      onUiStateResponse: () => {},
      onHalStateResponse: () => {},
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => {},
    });
  }

  it('opens https links via vscode.env.openExternal', async () => {
    const handler = createHandler();

    await handler({ type: 'openMarkdownLink', href: 'https://example.com' } as any);

    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
    const uriArg = (vscode.env.openExternal as any).mock.calls[0][0] as vscode.Uri;
    expect(uriArg.scheme).toBe('https');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('opens mailto links via vscode.env.openExternal', async () => {
    const handler = createHandler();

    await handler({ type: 'openMarkdownLink', href: 'mailto:test@example.com' } as any);

    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
    const uriArg = (vscode.env.openExternal as any).mock.calls[0][0] as vscode.Uri;
    expect(uriArg.scheme).toBe('mailto');
    expect((vscode.workspace as any).openTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does not open javascript: links externally', async () => {
    const handler = createHandler();

    await handler({ type: 'openMarkdownLink', href: 'javascript:alert(1)' } as any);

    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('does not open file:// links externally', async () => {
    const handler = createHandler();

    await handler({ type: 'openMarkdownLink', href: 'file:///etc/passwd' } as any);

    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('opens workspace-relative paths as files', async () => {
    const handler = createHandler();
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'hello');

    await handler({ type: 'openMarkdownLink', href: 'README.md' } as any);

    expect((vscode.workspace as any).openTextDocument).toHaveBeenCalledTimes(1);
    expect((vscode.window as any).showTextDocument).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('blocks path traversal outside the workspace', async () => {
    const handler = createHandler();

    await handler({ type: 'openMarkdownLink', href: '../secrets.txt' } as any);

    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Blocked unsafe link.');
    expect((vscode.workspace as any).openTextDocument).not.toHaveBeenCalled();
  });
});
