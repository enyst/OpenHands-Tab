import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../diffDocuments', () => ({
  showWorkspaceDiff: vi.fn(async () => {}),
}));

vi.mock('../gitHeadDiff', () => ({
  resolveGitHeadDiffContents: vi.fn(async (args: any) => ({
    oldContent: args.fallbackOldContent,
    newContent: args.fallbackNewContent,
    source: 'fallback',
  })),
}));

import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../createWebviewMessageHandler';
import { showWorkspaceDiff } from '../diffDocuments';
import { resolveGitHeadDiffContents } from '../gitHeadDiff';

describe('createWebviewMessageHandler(openWorkspaceDiff)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks?.();
  });

  it('uses an empty fallback before-content when preferGitHead is enabled', async () => {
    const handler = createWebviewMessageHandler({
      context: { subscriptions: [] } as any,
      host: { postMessage: vi.fn(async () => true) },
      getConversation: () => undefined,
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
      type: 'openWorkspaceDiff',
      path: 'README.md',
      oldContent: 'OLD CONTENT',
      newContent: 'NEW CONTENT',
      preferGitHead: true,
    });

    expect(resolveGitHeadDiffContents).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackOldContent: '',
        fallbackNewContent: 'NEW CONTENT',
      }),
    );

    expect(showWorkspaceDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'README.md',
        oldContent: '',
        newContent: 'NEW CONTENT',
      }),
    );
  });
});

