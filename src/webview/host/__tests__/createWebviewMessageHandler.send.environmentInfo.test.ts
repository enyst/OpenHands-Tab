import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../createWebviewMessageHandler';

describe('createWebviewMessageHandler(send) environment info suffix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks?.();
  });

  it('appends <environment information> to user messages in local mode', async () => {
    const conversation = {
      sendUserMessage: vi.fn(async () => {}),
    };

    (vscode.window as any).activeTextEditor = {
      document: { uri: { scheme: 'file', fsPath: '/test/workspace/src/a.ts' } },
    };
    (vscode.window as any).visibleTextEditors = [
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace/src/a.ts' } } },
      { document: { uri: { scheme: 'file', fsPath: '/test/workspace/src/b.ts' } } },
    ];

    const handler = createWebviewMessageHandler({
      context: { subscriptions: [] } as any,
      host: { postMessage: vi.fn(async () => true) },
      getConversation: () => conversation as any,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp',
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

    await handler({
      type: 'send',
      text: 'hello',
      contextFiles: [],
      attachments: [],
    } as any);

    expect(conversation.sendUserMessage).toHaveBeenCalledTimes(1);
    const sent = (conversation.sendUserMessage as any).mock.calls[0][0] as string;
    expect(sent).toContain('hello');
    expect(sent).toContain('<environment information>');
    expect(sent).toContain('Active editor: a.ts');
    expect(sent).toContain('Open editors:');
    expect(sent).toContain('- a.ts');
    expect(sent).toContain('- b.ts');
    expect(sent).toContain('</environment information>');
  });
});

