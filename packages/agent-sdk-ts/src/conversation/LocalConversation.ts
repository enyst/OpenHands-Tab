import EventEmitter from 'events';
import type { BashEvent, Event } from '../types';
import type { OpenHandsSettings } from '../types/settings';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
}

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
  }

  startNewConversation(): Promise<string | undefined> {
    this.conversationId = this.conversationId ?? `local-${Date.now().toString(36)}`;
    this.emit('conversationStarted', this.conversationId);
    return Promise.resolve(this.conversationId);
  }

  restoreConversation(id: string) {
    this.conversationId = id;
    this.emit('conversationStarted', id);
  }

  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      await this.startNewConversation();
    }
    const event: Event = {
      type: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text }] },
    } as Event;
    this.emit('event', event);
  }

  pause(): Promise<void> {
    this.emit('event', { type: 'PauseEvent', source: 'user' } as Event);
    return Promise.resolve();
  }

  resume(): Promise<void> { return Promise.resolve(); /* local resume no-op */ }

  approveAction(): Promise<void> { return Promise.resolve(); /* local approve no-op */ }

  rejectAction(_reason?: string): Promise<void> { return Promise.resolve(); /* local reject no-op */ }

  disconnect() {
    this.setStatus('offline');
  }

  reconnect() {
    this.setStatus('online');
  }

  private setStatus(status: ConversationStatus) {
    this.status = status;
    this.emit('status', status);
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
