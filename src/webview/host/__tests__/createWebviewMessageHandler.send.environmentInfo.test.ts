import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../createWebviewMessageHandler';

describe('createWebviewMessageHandler(send) environment info suffix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks?.();
  });

  it('does not append env block inline in local mode (env is routed via extendedContent)', async () => {
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
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
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
    // Env info is provided via extendedContent, not appended inline.
    expect(sent).not.toContain('<environment information>');
    expect(sent).not.toContain('Active editor:');
    expect(sent).not.toContain('Open editors:');
    expect(sent).not.toContain('- a.ts');
    expect(sent).not.toContain('- b.ts');
    expect(sent).not.toContain('</environment information>');

    const opts = (conversation.sendUserMessage as any).mock.calls[0][1] as any;
    expect(opts).toEqual({
      extendedContent: [
        {
          type: 'text',
          text: expect.stringContaining('<environment information>'),
        },
      ],
    });
  });

  it('does not append <environment information> to user messages in remote mode', async () => {
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
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => conversation as any,
      getConversationMode: () => 'remote',
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
    expect(sent).not.toContain('<environment information>');
    expect(sent).not.toContain('Active editor:');
    expect(sent).not.toContain('Open editors:');
    expect(sent).not.toContain('</environment information>');

    const opts = (conversation.sendUserMessage as any).mock.calls[0][1] as any;
    expect(opts).toBeUndefined();
  });

  it('drains queued user-edit notes into sendUserMessage extendedContent', async () => {
    const conversation = {
      sendUserMessage: vi.fn(async () => {}),
    };

    let queued = ['note one\nline 2', 'note two'];
    const getQueued = vi.fn(() => queued.slice());
    const clearQueued = vi.fn(() => { queued = []; });

    const handler = createWebviewMessageHandler({
      context: { subscriptions: [] } as any,
      host: { postMessage: vi.fn(async () => true) },
      getQueuedUserEditNotes: getQueued,
      clearQueuedUserEditNotes: clearQueued,
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

    await handler({ type: 'send', text: 'hello', contextFiles: [], attachments: [] } as any);
    await handler({ type: 'send', text: 'hello again', contextFiles: [], attachments: [] } as any);

    expect(getQueued).toHaveBeenCalledTimes(2);
    expect(clearQueued).toHaveBeenCalledTimes(1);

    expect(conversation.sendUserMessage).toHaveBeenCalledTimes(2);
    const firstCall = (conversation.sendUserMessage as any).mock.calls[0] as unknown[];
    const secondCall = (conversation.sendUserMessage as any).mock.calls[1] as unknown[];

    expect(firstCall[0]).toContain('hello');
    expect(firstCall[0]).not.toContain('note one');
    expect(firstCall[0]).not.toContain('note two');
    expect(firstCall[1]).toEqual({
      extendedContent: [
        { type: 'text', text: expect.stringContaining('<environment information>') },
        { type: 'text', text: 'note one\nline 2\n\nnote two' },
      ],
    });

    expect(secondCall[0]).toContain('hello again');
    expect(secondCall[1]).toEqual({
      extendedContent: [{ type: 'text', text: expect.stringContaining('<environment information>') }],
    });
  });

});
