import { describe, it, expect } from 'vitest';
import type { HostToWebviewMessage } from '../../shared/webviewMessages';
import { ConversationEventBacklog } from '../eventBacklog';

function mkMessageEvent(marker: string) {
  return {
    kind: 'MessageEvent',
    source: 'user',
    e2e_marker: marker,
    llm_message: { role: 'user', content: [{ type: 'text', text: marker }] },
  } as any;
}

describe('ConversationEventBacklog', () => {
  it('keeps the last N events and iterates in order', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 3 });
    backlog.reset('conv-1');

    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));
    backlog.push(mkMessageEvent('m3'));
    backlog.push(mkMessageEvent('m4'));

    expect(backlog.getSize()).toBe(3);
    expect(backlog.getEarliestSeq()).toBe(2);
    expect(backlog.getLatestSeq()).toBe(4);

    const seqs = Array.from(backlog.iter(), (item) => item.seq);
    expect(seqs).toEqual([2, 3, 4]);
  });

  it('defaults maxSize when provided value is invalid', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 0 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));

    expect(backlog.getSize()).toBe(2);
    expect(backlog.getLatestSeq()).toBe(2);
  });

  it('flushes a full replay when client conversation id mismatches', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-other',
      clientLastSeenSeq: 2,
    });

    expect(sent[0]).toEqual({ type: 'conversationStarted', conversationId: 'conv-1' });
    expect(sent.slice(1).map((m) => m.type)).toEqual(['event', 'event']);
    expect(sent.slice(1).map((m) => (m as any).seq)).toEqual([1, 2]);
  });

  it('flushes incremental events when lastSeenSeq is in range', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));
    backlog.push(mkMessageEvent('m3'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-1',
      clientLastSeenSeq: 2,
    });

    expect(sent.map((m) => m.type)).toEqual(['event']);
    expect((sent[0] as any).seq).toBe(3);
  });

  it('flushes a full replay when lastSeenSeq falls outside the buffer range', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 3 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));
    backlog.push(mkMessageEvent('m3'));
    backlog.push(mkMessageEvent('m4')); // buffer now holds seq 2..4

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-1',
      clientLastSeenSeq: 0,
    });

    expect(sent[0]).toEqual({ type: 'conversationStarted', conversationId: 'conv-1' });
    expect(sent.slice(1).map((m) => (m as any).seq)).toEqual([2, 3, 4]);
  });

  it('flushes a full replay when lastSeenSeq is invalid', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-1',
      clientLastSeenSeq: Number.NaN,
    });

    expect(sent[0]).toEqual({ type: 'conversationStarted', conversationId: 'conv-1' });
    expect(sent.slice(1).map((m) => m.type)).toEqual(['event']);
  });

  it('does nothing when client is already up to date', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));
    backlog.push(mkMessageEvent('m2'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-1',
      clientLastSeenSeq: 2,
    });

    expect(sent).toEqual([]);
  });

  it('uses fallback conversation id when none is stored', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset(undefined);
    backlog.push(mkMessageEvent('m1'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-1',
      clientLastSeenSeq: 0,
      fallbackConversationId: 'conv-1',
    });

    expect(sent.map((m) => m.type)).toEqual(['event']);
    expect((sent[0] as any).seq).toBe(1);
  });

  it('applies transformEvent to flushed events', () => {
    const backlog = new ConversationEventBacklog({ maxSize: 5 });
    backlog.reset('conv-1');
    backlog.push(mkMessageEvent('m1'));

    const sent: HostToWebviewMessage[] = [];
    backlog.flushToClient({
      postMessage: (message) => {
        sent.push(message);
        return Promise.resolve(true);
      },
      clientConversationId: 'conv-x',
      transformEvent: (event) => ({ ...(event as any), e2e_marker: 'transformed' }) as any,
    });

    expect((sent[1] as any).event.e2e_marker).toBe('transformed');
  });
});
