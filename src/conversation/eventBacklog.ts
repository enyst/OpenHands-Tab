import type { Event } from '@openhands/agent-sdk-ts';
import type { HostToWebviewMessage } from '../shared/webviewMessages';

export type BufferedConversationEvent = { seq: number; event: Event };

export type ConversationEventBacklogFlushParams = {
  postMessage: (message: HostToWebviewMessage) => Thenable<boolean>;
  clientConversationId?: string;
  clientLastSeenSeq?: number;
  fallbackConversationId?: string;
  transformEvent?: (event: Event) => Event;
};

export class ConversationEventBacklog {
  private readonly maxSize: number;
  private readonly buffer: Array<BufferedConversationEvent | undefined> = [];
  private start = 0;
  private size = 0;
  private seq = 0;
  private conversationId: string | undefined;

  constructor(options?: { maxSize?: number }) {
    const rawMaxSize = options?.maxSize;
    this.maxSize = typeof rawMaxSize === 'number' && Number.isFinite(rawMaxSize) && rawMaxSize > 0
      ? Math.floor(rawMaxSize)
      : 2000;
  }

  reset(conversationId: string | undefined): void {
    this.conversationId = conversationId;
    this.seq = 0;
    this.start = 0;
    this.size = 0;
    this.buffer.length = 0;
  }

  push(event: Event): number {
    this.seq += 1;
    const item: BufferedConversationEvent = { seq: this.seq, event };
    if (this.size < this.maxSize) {
      const idx = (this.start + this.size) % this.maxSize;
      this.buffer[idx] = item;
      this.size += 1;
    } else {
      this.buffer[this.start] = item;
      this.start = (this.start + 1) % this.maxSize;
    }
    return this.seq;
  }

  *iter(): Iterable<BufferedConversationEvent> {
    for (let i = 0; i < this.size; i += 1) {
      const idx = (this.start + i) % this.maxSize;
      const item = this.buffer[idx];
      if (item) yield item;
    }
  }

  getEarliestSeq(): number | undefined {
    return this.size > 0 ? this.seq - this.size + 1 : undefined;
  }

  getSize(): number {
    return this.size;
  }

  getLatestSeq(): number | undefined {
    return this.size > 0 ? this.seq : undefined;
  }

  getConversationId(): string | undefined {
    return this.conversationId;
  }

  flushToClient(params: ConversationEventBacklogFlushParams): void {
    const currentConversationId = this.conversationId ?? params.fallbackConversationId;
    if (!currentConversationId) {
      return;
    }

    const earliestSeq = this.getEarliestSeq();
    const latestSeq = this.getLatestSeq();
    const lastSeenSeq = params.clientLastSeenSeq;

    const lastSeenIsValid = typeof lastSeenSeq === 'number' && Number.isFinite(lastSeenSeq);
    const isInRange = lastSeenIsValid && (earliestSeq === undefined || lastSeenSeq >= earliestSeq - 1);
    const needsFullReplay = params.clientConversationId !== currentConversationId || !isInRange;

    const transformEvent = params.transformEvent ?? ((event: Event) => event);

    if (needsFullReplay) {
      void params.postMessage({ type: 'conversationStarted', conversationId: currentConversationId });
      for (const item of this.iter()) {
        void params.postMessage({ type: 'event', seq: item.seq, event: transformEvent(item.event) });
      }
      return;
    }

    if (latestSeq === undefined || lastSeenSeq === undefined || lastSeenSeq >= latestSeq) {
      return;
    }

    for (const item of this.iter()) {
      if (item.seq > lastSeenSeq) {
        void params.postMessage({ type: 'event', seq: item.seq, event: transformEvent(item.event) });
      }
    }
  }
}
