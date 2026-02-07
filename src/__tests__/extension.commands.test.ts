import * as fs from 'node:fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  getMockSettings,
  resetHarnessState,
  resolveChatView,
  setMockSettings,
} from './extension.test.harness';

describe('Command handlers', () => {
  let mockContext: any;
  let extension: any;
  let conversationInstance: any;
  let chatView: any;

  beforeEach(async () => {
    resetHarnessState();

    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
    chatView = await resolveChatView(mockContext);

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    conversationInstance = __getLastConversation();
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('starts a new conversation', async () => {
    await vscode.commands.executeCommand('openhands.startNewConversation');
    expect(conversationInstance.startNewConversation).toHaveBeenCalled();
  });

  it('starts a new conversation to explain the editor selection', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    (vscode.window as any).activeTextEditor = {
      selection: {
        isEmpty: false,
        start: { line: 3, character: 2 },
        end: { line: 5, character: 10 },
      },
      document: {
        languageId: 'typescript',
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/example.ts',
          toString: () => 'file:///test/workspace/src/example.ts',
        },
        getText: vi.fn(() => 'const x = 1;'),
      },
    };
    (vscode.window as any).visibleTextEditors = [(vscode.window as any).activeTextEditor];
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];

    await vscode.commands.executeCommand('openhands.explainSelection');

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const latestConversation = __getLastConversation();

    expect(latestConversation.startNewConversation).toHaveBeenCalled();
    expect(latestConversation.sendUserMessage).toHaveBeenCalled();
    const message = (latestConversation.sendUserMessage as unknown as Mock).mock.calls[0]?.[0] as string;
    expect(message).toContain('Please explain this code:');
    expect(message).toContain('/test/workspace/src/example.ts:4:3-6:11');
    expect(message).toContain('const x = 1;');
    expect(message).toContain('<environment information>');
    expect(message).toContain('Active editor: example.ts');
    expect(message).toContain('Open editors:');
    expect(message).toContain('- none');
    expect(message).toContain('</environment information>');
  });

  it('includes vscode-remote editors in environment info suffix', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: undefined as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    (vscode.window as any).activeTextEditor = {
      selection: {
        isEmpty: false,
        start: { line: 3, character: 2 },
        end: { line: 5, character: 10 },
      },
      document: {
        languageId: 'markdown',
        uri: {
          scheme: 'vscode-remote',
          fsPath: '/test/workspace/content/posts/ralph.md',
          toString: () => 'vscode-remote://ssh-remote+devcontainer/test/workspace/content/posts/ralph.md',
        },
        getText: vi.fn(() => '# hello'),
      },
    };
    (vscode.window as any).visibleTextEditors = [(vscode.window as any).activeTextEditor];
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];

    await vscode.commands.executeCommand('openhands.explainSelection');

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const latestConversation = __getLastConversation();

    expect(latestConversation.sendUserMessage).toHaveBeenCalled();
    const message = (latestConversation.sendUserMessage as unknown as Mock).mock.calls[0]?.[0] as string;
    expect(message).toContain('<environment information>');
    expect(message).toContain('Active editor: ralph.md');
    expect(message).toContain('Open editors:');
    expect(message).toContain('- none');
    expect(message).toContain('</environment information>');
  });

  it('sends reconnect/pause/resume commands', async () => {
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.pauseCurrentRun');
    await vscode.commands.executeCommand('openhands.resumeCurrentRun');

    expect(conversationInstance.reconnect).toHaveBeenCalled();
    expect(conversationInstance.pause).toHaveBeenCalled();
    expect(conversationInstance.resume).toHaveBeenCalled();
  });

  it('forwards webview send/command messages to conversation', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    await handler({ type: 'send', text: 'hello' });
    await handler({ type: 'command', command: 'approveAction' });
    await handler({ type: 'command', command: 'rejectAction', reason: 'nope' });

    expect(conversationInstance.sendUserMessage).toHaveBeenCalledWith('hello');
    expect(conversationInstance.approveAction).toHaveBeenCalled();
    expect(conversationInstance.rejectAction).toHaveBeenCalledWith('nope');
  });

  it('does not show a duplicate error popup for teleportAction failures', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    const executeCommand = vscode.commands.executeCommand as unknown as Mock;
    const originalImpl = executeCommand.getMockImplementation();
    try {
      executeCommand.mockImplementation(async (name: string, ...args: any[]) => {
        if (name === 'openhands._teleportToRemoteRuntime') {
          throw new Error('boom');
        }
        return originalImpl?.(name, ...args);
      });

      await handler({ type: 'command', command: 'teleportAction' });
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    } finally {
      executeCommand.mockImplementation(originalImpl);
    }
  });

  it('opens a diff view for openWorkspaceDiff messages', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    (vscode.commands.executeCommand as Mock).mockClear();

    await handler({ type: 'openWorkspaceDiff', path: 'README.md', oldContent: 'before', newContent: 'after' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Diff:'),
      expect.objectContaining({ preview: false })
    );
  });

  it('returns history from the stable conversation store', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-homedir-'));
    const cfgValues = (vscode as any).__getMockConfigValues?.();

    try {
      const conversationId = 'local-test-convo';
      const conversationsRoot = path.join(tmpHome, '.openhands', 'conversations-vscode');
      cfgValues?.set('openhands.conversation.storeRoot', conversationsRoot);
      const conversationDir = path.join(conversationsRoot, conversationId);
      await fs.mkdir(conversationDir, { recursive: true });

      const eventsPath = path.join(conversationDir, 'events.jsonl');
      const messageEvent = {
        kind: 'MessageEvent',
        llm_message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello from history' }],
        },
      };
      await fs.writeFile(eventsPath, `${JSON.stringify(messageEvent)}\n`, 'utf8');

      (chatView.webview.postMessage as Mock).mockClear();
      await handler({ type: 'requestHistory' });

      const historyMessage = (chatView.webview.postMessage as Mock).mock.calls
        .map((call) => call[0])
        .find((payload) => payload?.type === 'historyList') as any;

      expect(historyMessage).toBeTruthy();
      expect(historyMessage.conversations).toEqual([
        expect.objectContaining({
          id: conversationId,
          firstMessage: 'hello from history',
        }),
      ]);
    } finally {
      cfgValues?.delete('openhands.conversation.storeRoot');
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });
});
