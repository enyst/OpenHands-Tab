import type { ConversationStateUpdateEvent, Event } from '../types';
import { isConversationStateUpdateEvent } from '../types';
import { EventLog } from './EventLog';
import type { ConversationPersistence } from './persistence';

export interface AgentState {
  status: string;
  iteration: number;
  values: Record<string, unknown>;
}

export interface ConversationStateOptions {
  eventLog?: EventLog;
  persistence?: ConversationPersistence;
  initialState?: AgentState;
}

export class ConversationState {
  private state: AgentState;
  private eventLog: EventLog;
  private persistence?: ConversationPersistence;

  constructor(options: ConversationStateOptions = {}) {
    this.eventLog = options.eventLog ?? new EventLog();
    this.persistence = options.persistence;
    this.state = options.initialState ?? {
      status: 'idle',
      iteration: 0,
      values: {},
    };
  }

  get snapshot(): AgentState {
    return { ...this.state, values: { ...this.state.values } };
  }

  incrementIteration(): AgentState {
    return this.updateState({ iteration: this.state.iteration + 1 }, true);
  }

  setStatus(status: string): AgentState {
    return this.updateState({ agent_status: status }, true);
  }

  setValue(key: string, value: unknown): AgentState {
    return this.updateState({ key, value }, true);
  }

  restore(snapshot: AgentState): AgentState {
    this.state = { ...snapshot, values: { ...snapshot.values } };
    return this.snapshot;
  }

  loadEvents(events: Event[]): AgentState {
    this.state = { status: 'idle', iteration: 0, values: {} };
    events.filter(isConversationStateUpdateEvent).forEach((event) => {
      this.updateState(event, false);
    });
    this.persistSnapshot();
    return this.snapshot;
  }

  attachEventLog(eventLog: EventLog): void {
    this.eventLog = eventLog;
  }

  attachPersistence(persistence: ConversationPersistence): void {
    this.persistence = persistence;
  }

  persistSnapshot(): void {
    this.persistence?.writeState(this.snapshot);
  }

  private updateState(
    update: Partial<Omit<ConversationStateUpdateEvent, 'kind' | 'source'>>,
    emitEvent: boolean,
  ): AgentState {
    if (typeof update.iteration === 'number') {
      this.state = { ...this.state, iteration: update.iteration };
    }
    if (typeof update.agent_status === 'string') {
      this.state = { ...this.state, status: update.agent_status };
    }
    if (update.key) {
      this.state = { ...this.state, values: { ...this.state.values, [update.key]: update.value } };
    }

    if (emitEvent) {
      this.emitUpdate(update);
    }

    this.persistSnapshot();
    return this.snapshot;
  }

  private emitUpdate(update: Omit<Partial<ConversationStateUpdateEvent>, 'kind' | 'source'>): void {
    const event: ConversationStateUpdateEvent = {
      ...update,
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
    };
    this.eventLog.push(event);
  }
}
