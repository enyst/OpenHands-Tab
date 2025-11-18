import type { Message, ToolCall } from '../types';

export type LLMProvider = 'openai' | 'litellm_proxy' | 'openrouter' | 'anthropic';

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface LLMConfiguration {
  provider?: LLMProvider;
  model: string;
  usageId?: string | null;
  baseUrl?: string | null;
  apiKey?: string;
  apiVersion?: string | null;
  timeoutSeconds?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  nativeToolCalling?: boolean | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none' | null;
  headers?: Record<string, string>;
  /** Cost per input token in USD (or base currency). */
  inputCostPerToken?: number | null;
  /** Cost per output token in USD (or base currency). */
  outputCostPerToken?: number | null;
}

export interface ChatCompletionRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: LLMToolDefinition[];
}

export type LLMStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'tool_call_delta'; id: string; name?: string; arguments?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: 'finish'; finishReason?: string };

export interface LLMResponse {
  message: Message;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface LLMClient {
  streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk>;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: (status: number) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2000,
  retryOn: (status: number): boolean => [408, 409, 425, 429, 500, 502, 503, 504].includes(status),
};

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface ToolCallAccumulator {
  complete: ToolCall[];
  applyDelta(delta: { id: string; name?: string; arguments?: string }): ToolCall[];
}

export const reduceTextContent = (message: Message): string =>
  message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
