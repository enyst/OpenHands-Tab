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
  tools: any[]; // ChatCompletionToolParam
}

// ActionEvent - shown in visualizer
export interface ActionEvent extends EventBase {
  type: 'ActionEvent';
  source: 'agent';
  thought: TextContent[];
  reasoning_content?: string | null;
  action: any | null; // Action schema
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
  observation: any; // Observation schema
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
}

// Legacy fallback types for backward compatibility
export interface SystemEvent extends EventBase {
  type: 'system';
  level?: 'info'|'warn'|'error';
  message: string;
}

export interface ErrorEvent extends EventBase {
  type: 'error';
  error: string;
  code?: string|number;
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
  | ConversationStateUpdateEvent
  | SystemEvent
  | ErrorEvent;

// Event-level guard
export const isEvent = (e: any): e is Event => {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return false;
  const t = e.type;

  // New agent-sdk event types
  if (t === 'SystemPromptEvent') return !!e.system_prompt && !!e.tools;
  if (t === 'ActionEvent') return !!e.tool_name && Array.isArray(e.thought);
  if (t === 'ObservationEvent') return !!e.observation && !!e.tool_name;
  if (t === 'UserRejectObservation') return typeof e.rejection_reason === 'string';
  if (t === 'MessageEvent') return !!e.llm_message && typeof e.llm_message === 'object';
  if (t === 'AgentErrorEvent') return typeof e.error === 'string' && !!e.tool_name;
  if (t === 'PauseEvent') return e.source === 'user';
  if (t === 'Condensation') return Array.isArray(e.forgotten_event_ids);
  if (t === 'ConversationStateUpdateEvent') return true;

  // Legacy event types for backward compatibility
  if (t === 'message') return !!e.message && typeof e.message === 'object';
  if (t === 'action') return true; // Legacy action format
  if (t === 'observation') return true; // Legacy observation format
  if (t === 'system') return typeof e.message === 'string';
  if (t === 'error') return typeof e.error === 'string';

  return false;
};

// Content guards
export const isTextContent = (c: Content): c is TextContent => c.type === 'text';
export const isImageContent = (c: Content): c is ImageContent => c.type === 'image';

// Event kind guards - agent-sdk events
export const isSystemPromptEvent = (e: Event): e is SystemPromptEvent => e.type === 'SystemPromptEvent';
export const isActionEvent = (e: Event): e is ActionEvent => e.type === 'ActionEvent';
export const isObservationEvent = (e: Event): e is ObservationEvent => e.type === 'ObservationEvent';
export const isUserRejectObservation = (e: Event): e is UserRejectObservation => e.type === 'UserRejectObservation';
export const isMessageEvent = (e: Event): e is MessageEvent => e.type === 'MessageEvent' || e.type === 'message';
export const isAgentErrorEvent = (e: Event): e is AgentErrorEvent => e.type === 'AgentErrorEvent';
export const isPauseEvent = (e: Event): e is PauseEvent => e.type === 'PauseEvent';
export const isCondensation = (e: Event): e is Condensation => e.type === 'Condensation';
export const isConversationStateUpdateEvent = (e: Event): e is ConversationStateUpdateEvent => e.type === 'ConversationStateUpdateEvent';

// Legacy event guards for backward compatibility
export const isSystemEvent = (e: Event): e is SystemEvent => e.type === 'system';
export const isErrorEvent = (e: Event): e is ErrorEvent => e.type === 'error';
