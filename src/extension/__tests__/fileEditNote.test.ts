import { describe, expect, it, vi } from 'vitest';
import { createFileEditNoteTracker } from '../fileEditNote';

describe('fileEditNote tracker', () => {
  it('queues notes for watched files (does not emit a run=false user message)', async () => {
    const conversation = {
      mode: 'local' as const,
      getConversationId: () => 'local-1',
      sendUserMessage: vi.fn(async () => {}),
    };

    const tracker = createFileEditNoteTracker({
      getConversation: () => conversation as any,
      getOutputChannel: () => undefined,
      renderError: (e) => String(e),
      getGitHeadDiffSummaryForFile: vi.fn(async () => 'diff summary'),
    });

    tracker.trackAgentEditedFile('/test/workspace/src/a.ts');

    await tracker.onDidSaveTextDocument({
      uri: { scheme: 'file', fsPath: '/test/workspace/src/a.ts' },
    } as any);

    expect(conversation.sendUserMessage).not.toHaveBeenCalled();

    const queued = tracker.getQueuedUserEditNotes();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('Environment note: user edited file:');
    expect(queued[0]).toContain('/test/workspace/src/a.ts');
    expect(queued[0]).toContain('diff summary');

    tracker.clearQueuedUserEditNotes();
    expect(tracker.getQueuedUserEditNotes()).toEqual([]);
  });

  it('ignores saves when the active conversation is remote', async () => {
    const tracker = createFileEditNoteTracker({
      getConversation: () => ({ mode: 'remote', getConversationId: () => 'remote-1' } as any),
      getOutputChannel: () => undefined,
      renderError: (e) => String(e),
      getGitHeadDiffSummaryForFile: vi.fn(async () => 'diff summary'),
    });

    tracker.trackAgentEditedFile('/test/workspace/src/a.ts');

    await tracker.onDidSaveTextDocument({
      uri: { scheme: 'file', fsPath: '/test/workspace/src/a.ts' },
    } as any);

    expect(tracker.getQueuedUserEditNotes()).toEqual([]);
  });
});

