import type { ConversationStateUpdateEvent } from '../types';
import { EventLog } from './EventLog';

export interface AgentState {
  status: string;
  iteration: number;
  values: Record<string, unknown>;
}

export class ConversationState {
  private state: AgentState = {
    status: 'idle',
    iteration: 0,
    values: {},
  };

  constructor(private events: EventLog = new EventLog()) {}

  get snapshot(): AgentState {
    return { ...this.state, values: { ...this.state.values } };
  }

  incrementIteration(): AgentState {
    this.state = { ...this.state, iteration: this.state.iteration + 1 };
    this.emitUpdate({ iteration: this.state.iteration });
    return this.snapshot;
  }

  setStatus(status: string): AgentState {
    this.state = { ...this.state, status };
    this.emitUpdate({ agent_status: status });
    return this.snapshot;
  }

  setValue(key: string, value: unknown): AgentState {
    this.state = { ...this.state, values: { ...this.state.values, [key]: value } };
    this.emitUpdate({ key, value });
    return this.snapshot;
  }

  attachEventLog(events: EventLog): void {
    this.events = events;
  }

  private emitUpdate(update: Omit<Partial<ConversationStateUpdateEvent>, 'kind' | 'source'>): void {
    const event: ConversationStateUpdateEvent = {
      ...update,
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
    };
    this.events.push(event);
  }
}
