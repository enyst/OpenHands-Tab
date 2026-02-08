import type { ActionEvent, Event, ObservationEvent, ToolCall } from '../types';
import type { ConversationState } from './ConversationState';
import type { EventLog } from './EventLog';

export type BeforeToolCallHookResult =
  | void
  | {
      args?: Record<string, unknown>;
    };

export interface BeforeToolCallHookParams {
  toolCall: ToolCall;
  actionEvent: ActionEvent;
  args: Record<string, unknown>;
}

export interface AfterToolCallHookParams {
  toolCall: ToolCall;
  actionEvent: ActionEvent;
  args: Record<string, unknown>;
  observationEvent?: ObservationEvent;
  error?: unknown;
}

export interface AfterEventHookParams {
  event: Event;
}

export interface ShouldStopHookParams {
  state: ConversationState;
  events: EventLog;
}

export interface AgentHook {
  beforeToolCall?: (params: BeforeToolCallHookParams) => BeforeToolCallHookResult | Promise<BeforeToolCallHookResult>;
  afterToolCall?: (params: AfterToolCallHookParams) => void | Promise<void>;
  afterEvent?: (params: AfterEventHookParams) => void | Promise<void>;
  shouldStop?: (params: ShouldStopHookParams) => boolean | Promise<boolean>;
}

