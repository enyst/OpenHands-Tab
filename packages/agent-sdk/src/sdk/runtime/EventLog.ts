import { randomUUID } from 'crypto';
import { isEvent, isConversationStateUpdateEvent, type Event } from '../types';
import type { ConversationPersistence } from './persistence';

export type EventListener = (event: Event) => void;

export interface EventLogOptions {
  events?: Event[];
  persistence?: ConversationPersistence;
}

export class EventLog {
  private readonly events: Event[] = [];
  private readonly listeners: Set<EventListener> = new Set();
  private persistence?: ConversationPersistence;

  constructor(options: EventLogOptions = {}) {
    this.persistence = options.persistence;
    const seedEvents = options.events ?? [];
    if (seedEvents.length) {
      this.replay(seedEvents, false);
    }
  }

  push(event: Event): Event {
    return this.record(event, { emit: true, persist: true });
  }

  replay(events: Event[], emit = true): Event[] {
    return events.map((event) => this.record(event, { emit, persist: false }));
  }

  list(): Event[] {
    return [...this.events];
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attachPersistence(persistence: ConversationPersistence): void {
    this.persistence = persistence;
  }

  private record(event: Event, options: { emit: boolean; persist: boolean }): Event {
    if (!isEvent(event)) {
      throw new Error('Attempted to push invalid event');
    }

    const normalized: Event = {
      ...event,
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    this.events.push(normalized);

    // Persist only durable events. Drop transient LLM streaming state updates to avoid
    // bloating events.jsonl with in-stream fragments.
    if (options.persist && this.persistence) {
      let shouldPersist = true;
      if (isConversationStateUpdateEvent(normalized)) {
        const key = normalized.key;
        if (key === 'llm_stream' || key === 'llm_tool_call') {
          shouldPersist = false;
        }
      }
      if (shouldPersist) this.persistence.appendEvent(normalized);
    }

    if (options.emit) {
      this.listeners.forEach((listener) => listener(normalized));
    }

    return normalized;
  }
}
