import { randomUUID } from 'crypto';
import { isEvent, type Event } from '../types';

export type EventListener = (event: Event) => void;

export class EventLog {
  private readonly events: Event[] = [];
  private readonly listeners: Set<EventListener> = new Set();

  push(event: Event): Event {
    if (!isEvent(event)) {
      throw new Error('Attempted to push invalid event');
    }
    const normalized: Event = {
      ...event,
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.events.push(normalized);
    this.listeners.forEach((listener) => listener(normalized));
    return normalized;
  }

  list(): Event[] {
    return [...this.events];
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
