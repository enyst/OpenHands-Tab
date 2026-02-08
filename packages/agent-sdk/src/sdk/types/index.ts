// TypeScript models mirroring agent-server (agent-sdk) wire format

import type {
  Content,
  ImageContent,
  Message,
  RedactedThinkingBlock,
  ResponsesReasoningItem,
  Role,
  SecurityRisk,
  SourceType,
  TextContent,
  ThinkingBlock,
  ThinkingBlockEvent,
  ToolCall,
} from './messageTypes';
export type {
  Content,
  ImageContent,
  Message,
  RedactedThinkingBlock,
  ResponsesReasoningItem,
  Role,
  SecurityRisk,
  SourceType,
  TextContent,
  ThinkingBlock,
  ThinkingBlockEvent,
  ToolCall,
};

export interface EventBase {
  id?: string;
  kind: string;
  timestamp?: string;
  source?: SourceType;
}

// SystemPromptEvent - shown in visualizer
export interface SystemPromptEvent extends EventBase {
  kind: 'SystemPromptEvent';
  source: 'agent';
  system_prompt: TextContent;
  tools: Record<string, unknown>[]; // ChatCompletionToolParam serialized to JSON
}

// ActionEvent - shown in visualizer
export interface ActionEvent extends EventBase {
  kind: 'ActionEvent';
  source: 'agent';
  thought: TextContent[];
  reasoning_content?: string | null;
  thinking_blocks?: ThinkingBlockEvent[] | null;
  responses_reasoning_item?: ResponsesReasoningItem | null;
  action: Record<string, unknown> | null; // Action schema serialized to JSON
  tool_name: string;
  tool_call_id: string;
  tool_call: ToolCall;
  llm_response_id: string;
  security_risk?: SecurityRisk;
}

// ObservationEvent - shown in visualizer
export interface ObservationEvent extends EventBase {
  kind: 'ObservationEvent';
  source: 'environment';
  observation: Record<string, unknown>; // Observation schema serialized to JSON
  tool_name: string;
  tool_call_id: string;
  action_id: string;
}

// UserRejectObservation - shown in visualizer
export interface UserRejectObservation extends EventBase {
  kind: 'UserRejectObservation';
  source: 'environment';
  rejection_reason: string;
  tool_name: string;
  tool_call_id: string;
  action_id: string;
}

// MessageEvent - shown in visualizer
export interface MessageEvent extends EventBase {
  kind: 'MessageEvent';
  source: SourceType;
  llm_message: Message;
  activated_skills?: string[];
  extended_content?: TextContent[];
}

// AgentErrorEvent - shown in visualizer
export interface AgentErrorEvent extends EventBase {
  kind: 'AgentErrorEvent';
  source: 'agent';
  error: string;
  tool_name: string;
  tool_call_id: string;
}

export interface ConversationErrorEvent extends EventBase {
  kind: 'ConversationErrorEvent';
  source: SourceType;
  code?: string;
  detail?: string;
}

export const DEFAULT_CONVERSATION_ERROR_MESSAGE = 'Conversation error';

export const visualizeConversationErrorEvent = (event: ConversationErrorEvent): string => {
  const lines: string[] = [];
  const code = event.code?.trim() ?? '';
  const detail = event.detail?.trim() ?? '';
  if (code) lines.push(`code: ${code}`);
  if (detail) lines.push(`detail: ${detail}`);
  return lines.length ? lines.join('\n') : DEFAULT_CONVERSATION_ERROR_MESSAGE;
};

// PauseEvent - shown in visualizer
export interface PauseEvent extends EventBase {
  kind: 'PauseEvent';
  source: 'agent' | 'user';
}

// Condensation - shown in visualizer
export interface Condensation extends EventBase {
  kind: 'Condensation';
  source: 'environment';
  forgotten_event_ids: string[];
  summary?: string | null;
  summary_offset?: number | null;
}

// ConversationStateUpdateEvent - state tracking
export interface ConversationStateUpdateEvent extends EventBase {
  kind: 'ConversationStateUpdateEvent';
  agent_status?: string;
  iteration?: number;
  key?: string;
  value?: unknown;
}

export type Event =
  | SystemPromptEvent
  | ActionEvent
  | ObservationEvent
  | UserRejectObservation
  | MessageEvent
  | AgentErrorEvent
  | ConversationErrorEvent
  | PauseEvent
  | Condensation
  | ConversationStateUpdateEvent;

export type { ToolContext, ToolDefinition } from './tools';

// Event-level guard
export const isEvent = (candidate: unknown): candidate is Event => {
  if (!candidate || typeof candidate !== 'object') return false;
  const obj = candidate as Record<string, unknown>;
  const kind = typeof obj.kind === 'string' ? obj.kind : undefined;
  if (!kind) return false;

  switch (kind) {
    case 'SystemPromptEvent':
      return !!obj.system_prompt && Array.isArray(obj.tools);
    case 'ActionEvent':
      return !!obj.tool_name && Array.isArray(obj.thought);
    case 'ObservationEvent':
      return !!obj.observation && !!obj.tool_name;
    case 'UserRejectObservation':
      return typeof obj.rejection_reason === 'string' && !!obj.tool_name;
    case 'MessageEvent':
      return !!obj.llm_message && typeof obj.llm_message === 'object';
    case 'AgentErrorEvent':
      return typeof obj.error === 'string' && !!obj.tool_name;
    case 'ConversationErrorEvent':
      return typeof obj.detail === 'string' || typeof obj.code === 'string';
    case 'PauseEvent':
      return obj.source === 'user' || obj.source === 'agent';
    case 'Condensation':
      return Array.isArray(obj.forgotten_event_ids);
    case 'ConversationStateUpdateEvent':
      return true;
    default:
      return false;
  }
};

// Content guards
export const isTextContent = (content: Content): content is TextContent => content.type === 'text';
export const isImageContent = (content: Content): content is ImageContent => content.type === 'image';

// Event kind guards (kind-only)
const eventDiscriminant = (e: unknown): string | undefined => {
  if (!e || typeof e !== 'object') return undefined;
  if (!('kind' in e)) return undefined;
  const k = (e as { kind?: unknown }).kind;
  return typeof k === 'string' ? k : undefined;
};

export const isSystemPromptEvent = (event: Event): event is SystemPromptEvent => eventDiscriminant(event) === 'SystemPromptEvent';
export const isActionEvent = (event: Event): event is ActionEvent => eventDiscriminant(event) === 'ActionEvent';
export const isObservationEvent = (event: Event): event is ObservationEvent => eventDiscriminant(event) === 'ObservationEvent';
export const isUserRejectObservation = (event: Event): event is UserRejectObservation => eventDiscriminant(event) === 'UserRejectObservation';
export const isMessageEvent = (event: Event): event is MessageEvent => eventDiscriminant(event) === 'MessageEvent';
export const isAgentErrorEvent = (event: Event): event is AgentErrorEvent => eventDiscriminant(event) === 'AgentErrorEvent';
export const isConversationErrorEvent = (event: Event): event is ConversationErrorEvent => eventDiscriminant(event) === 'ConversationErrorEvent';
export const isPauseEvent = (event: Event): event is PauseEvent => eventDiscriminant(event) === 'PauseEvent';
export const isCondensation = (event: Event): event is Condensation => eventDiscriminant(event) === 'Condensation';
export const isConversationStateUpdateEvent = (event: Event): event is ConversationStateUpdateEvent => eventDiscriminant(event) === 'ConversationStateUpdateEvent';

export * from './settings';

// ========================================
// Bash Events (separate WebSocket stream)
// ========================================

export interface BashEventBase {
  id: string;
  type: string;
  timestamp: string;
  command_id: string;
  order: number;
}

export interface BashCommand extends BashEventBase {
  type: 'BashCommand';
  command: string;
}

export interface BashOutput extends BashEventBase {
  type: 'BashOutput';
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
}

export interface BashExit extends BashEventBase {
  type: 'BashExit';
  exit_code: number;
}

export type BashEvent = BashCommand | BashOutput | BashExit;

// Bash event guards
export const isBashEvent = (candidate: unknown): candidate is BashEvent => {
  if (!candidate || typeof candidate !== 'object') return false;
  const e = candidate as Record<string, unknown>;

  if (
    typeof e.type !== 'string' ||
    typeof e.command_id !== 'string' ||
    typeof e.order !== 'number'
  ) {
    return false;
  }

  switch (e.type) {
    case 'BashCommand':
      return typeof e.command === 'string';
    case 'BashOutput':
      return (
        ('exit_code' in e && (e.exit_code === null || typeof e.exit_code === 'number'))
        && ('stdout' in e && (e.stdout === null || typeof e.stdout === 'string'))
        && ('stderr' in e && (e.stderr === null || typeof e.stderr === 'string'))
      );
    case 'BashExit':
      return typeof e.exit_code === 'number';
    default:
      return false;
  }
};

export const isBashCommand = (event: BashEvent): event is BashCommand => event.type === 'BashCommand';
export const isBashOutput = (event: BashEvent): event is BashOutput => event.type === 'BashOutput';
export const isBashExit = (event: BashEvent): event is BashExit => event.type === 'BashExit';
