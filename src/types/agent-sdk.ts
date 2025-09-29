// TypeScript models mirroring agent-server (agent-sdk) wire format

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface TextContent { type: 'text'; text: string; }
export interface ImageContent { type: 'image'; image: string; alt?: string; }

export type Content = TextContent | ImageContent;

export interface Message {
  role: Role;
  content: Content[];
  id?: string;
  created_at?: string | number;
}

export interface EventBase { id?: string; type: string; ts?: number; }

export interface ActionEvent extends EventBase {
  type: 'action';
  action: { name: string; params?: Record<string, unknown>; thought?: string };
}

export interface ObservationEvent extends EventBase {
  type: 'observation';
  observation: { name?: string; result?: unknown; error?: string; stdout?: string; stderr?: string };
}

export interface MessageEvent extends EventBase { type: 'message'; message: Message; }
export interface SystemEvent extends EventBase { type: 'system'; level?: 'info'|'warn'|'error'; message: string; }
export interface ErrorEvent extends EventBase { type: 'error'; error: string; code?: string|number }

export type Event = ActionEvent | ObservationEvent | MessageEvent | SystemEvent | ErrorEvent;

// Event-level guard
export const isEvent = (e: any): e is Event => {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return false;
  const t = e.type;
  if (t === 'message') return !!e.message && typeof e.message === 'object' && Array.isArray(e.message.content);
  if (t === 'action') return !!e.action && typeof e.action.name === 'string';
  if (t === 'observation') return !!e.observation && typeof e.observation === 'object';
  if (t === 'system') return typeof e.message === 'string';
  if (t === 'error') return typeof e.error === 'string';
  return false;
};

// Content guards
export const isTextContent = (c: Content): c is TextContent => c.type === 'text';
export const isImageContent = (c: Content): c is ImageContent => c.type === 'image';

// Event kind guards
export const isMessageEvent = (e: Event): e is MessageEvent => e.type === 'message';
export const isActionEvent = (e: Event): e is ActionEvent => e.type === 'action';
export const isObservationEvent = (e: Event): e is ObservationEvent => e.type === 'observation';
export const isSystemEvent = (e: Event): e is SystemEvent => e.type === 'system';
export const isErrorEvent = (e: Event): e is ErrorEvent => e.type === 'error';
