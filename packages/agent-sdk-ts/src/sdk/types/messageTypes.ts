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

export interface ResponsesReasoningItem {
  id: string;
  summary?: string[];
  content?: string[] | null;
  encrypted_content?: string;
  status?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string | null;
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

export type ThinkingBlockEvent = ThinkingBlock | RedactedThinkingBlock;

export interface Message {
  role: Role;
  content: Content[];
  id?: string;
  created_at?: string | number;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
  /** Signature for the thinking block (required when passing thinking back to Anthropic) */
  thinking_signature?: string;
  responses_reasoning_item?: ResponsesReasoningItem | null;
}
