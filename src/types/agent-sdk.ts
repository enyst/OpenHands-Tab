// TypeScript models mirroring agent-server (agent-sdk) wire format

export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type SourceType = 'agent' | 'user' | 'environment';
export type SecurityRisk = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface TextContent { type: 'text'; text: string; }
export interface ImageContent { type: 'image'; image_urls?: string[]; detail?: string; }

export type Content = TextContent | ImageContent;

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: Role;
  content: Content[];
  id?: string;
  created_at?: string | number;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface EventBase {
  id?: string;
  type: string;
  timestamp?: string;
  source?: SourceType;
}

// SystemPromptEvent - shown in visualizer
export interface SystemPromptEvent extends EventBase {
  type: 'SystemPromptEvent';
  source: 'agent';
  system_prompt: TextContent;
  tools: Record<string, unknown>[]; // ChatCompletionToolParam serialized to JSON
}

// ActionEvent - shown in visualizer
export interface ActionEvent extends EventBase {
  type: 'ActionEvent';
  source: 'agent';
  thought: TextContent[];
  reasoning_content?: string | null;
  action: Record<string, unknown> | null; // Action schema serialized to JSON
  tool_name: string;
  tool_call_id: string;
  tool_call: ToolCall;
  llm_response_id: string;
  security_risk?: SecurityRisk;
}

// ObservationEvent - shown in visualizer
export interface ObservationEvent extends EventBase {
  type: 'ObservationEvent';
  source: 'environment';
  observation: Record<string, unknown>; // Observation schema serialized to JSON
  tool_name: string;
  tool_call_id: string;
  action_id: string;
}

// UserRejectObservation - shown in visualizer
export interface UserRejectObservation extends EventBase {
  type: 'UserRejectObservation';
  source: 'environment';
  rejection_reason: string;
  tool_name: string;
  tool_call_id: string;
  action_id: string;
}

// MessageEvent - shown in visualizer
export interface MessageEvent extends EventBase {
  type: 'MessageEvent';
  source: SourceType;
  llm_message: Message;
  activated_microagents?: string[];
  activated_skills?: string[];
  extended_content?: TextContent[];
}

// AgentErrorEvent - shown in visualizer
export interface AgentErrorEvent extends EventBase {
  type: 'AgentErrorEvent';
  source: 'agent';
  error: string;
  tool_name: string;
  tool_call_id: string;
}

// PauseEvent - shown in visualizer
export interface PauseEvent extends EventBase {
  type: 'PauseEvent';
  source: 'user';
}

// Condensation - shown in visualizer
export interface Condensation extends EventBase {
  type: 'Condensation';
  source: 'environment';
  forgotten_event_ids: string[];
  summary?: string | null;
  summary_offset?: number | null;
}

// ConversationStateUpdateEvent - state tracking
export interface ConversationStateUpdateEvent extends EventBase {
  type: 'ConversationStateUpdateEvent';
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
  | PauseEvent
  | Condensation
  | ConversationStateUpdateEvent;

// Event-level guard
export const isEvent = (e: unknown): e is Event => {
  if (!e || typeof e !== 'object') return false;
  const obj = e as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
  const t = obj.type;

  // Agent-sdk event types - strict validation
  if (t === 'SystemPromptEvent') return !!obj.system_prompt && Array.isArray(obj.tools);
  if (t === 'ActionEvent') return !!obj.tool_name && Array.isArray(obj.thought);
  if (t === 'ObservationEvent') return !!obj.observation && !!obj.tool_name;
  if (t === 'UserRejectObservation') return typeof obj.rejection_reason === 'string' && !!obj.tool_name;
  if (t === 'MessageEvent') return !!obj.llm_message && typeof obj.llm_message === 'object';
  if (t === 'AgentErrorEvent') return typeof obj.error === 'string' && !!obj.tool_name;
  if (t === 'PauseEvent') return obj.source === 'user';
  if (t === 'Condensation') return Array.isArray(obj.forgotten_event_ids);
  if (t === 'ConversationStateUpdateEvent') return true;

  return false;
};

// Content guards
export const isTextContent = (c: Content): c is TextContent => c.type === 'text';
export const isImageContent = (c: Content): c is ImageContent => c.type === 'image';

// Event kind guards
export const isSystemPromptEvent = (e: Event): e is SystemPromptEvent => e.type === 'SystemPromptEvent';
export const isActionEvent = (e: Event): e is ActionEvent => e.type === 'ActionEvent';
export const isObservationEvent = (e: Event): e is ObservationEvent => e.type === 'ObservationEvent';
export const isUserRejectObservation = (e: Event): e is UserRejectObservation => e.type === 'UserRejectObservation';
export const isMessageEvent = (e: Event): e is MessageEvent => e.type === 'MessageEvent';
export const isAgentErrorEvent = (e: Event): e is AgentErrorEvent => e.type === 'AgentErrorEvent';
export const isPauseEvent = (e: Event): e is PauseEvent => e.type === 'PauseEvent';
export const isCondensation = (e: Event): e is Condensation => e.type === 'Condensation';
export const isConversationStateUpdateEvent = (e: Event): e is ConversationStateUpdateEvent => e.type === 'ConversationStateUpdateEvent';

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
export const isBashEvent = (e: any): e is BashEvent => {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return false;
  if (!e.command_id || typeof e.order !== 'number') return false;

  const t = e.type;
  if (t === 'BashCommand') return typeof e.command === 'string';
  if (t === 'BashOutput') return 'exit_code' in e && 'stdout' in e && 'stderr' in e;
  if (t === 'BashExit') return typeof e.exit_code === 'number';

  return false;
};

export const isBashCommand = (e: BashEvent): e is BashCommand => e.type === 'BashCommand';
export const isBashOutput = (e: BashEvent): e is BashOutput => e.type === 'BashOutput';
export const isBashExit = (e: BashEvent): e is BashExit => e.type === 'BashExit';
