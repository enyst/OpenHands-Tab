import type { Message, ResponsesReasoningItem, ToolCall } from '../types/messageTypes';

export type LLMProvider = 'openai' | 'litellm_proxy' | 'openrouter' | 'anthropic' | 'gemini';

export type OpenAIChatApi = 'chat_completions' | 'responses';

export type ReasoningSummary = 'auto' | 'concise' | 'detailed';

/**
 * Reference (or explicit inline value) for resolving an LLM provider API key.
 *
 * - Prefer `{ kind: 'key', name: 'OPENAI_API_KEY' }` (or any other SecretRegistry key name).
 *   This keeps secrets out of profile JSON and allows resolution at request time via SecretRegistry
 *   (SecretStorage/env/in-memory).
 * - `{ kind: 'inline', value: 'sk-...' }` is supported for explicit opt-in cases where the caller
 *   wants to provide the raw credential directly. Avoid persisting this to disk unless you
 *   understand the security trade-offs.
 */
export type ApiKeyRef =
  | { kind: 'key'; name: string }
  | { kind: 'inline'; value: string };

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
  /** Optional LLM profile identifier (filename stem under ~/.openhands/llm-profiles/). */
  profileId?: string | null;
  usageId?: string | null;
  /** Only applies to OpenAI provider. */
  openaiApiMode?: OpenAIChatApi | null;
  baseUrl?: string | null;
  apiKeyRef?: ApiKeyRef | null;
  apiVersion?: string | null;
  timeoutSeconds?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'none' | null;
  /** Responses-only; ignored by Chat Completions. */
  reasoningSummary?: ReasoningSummary | null;
  headers?: Record<string, string>;
  /** Cost per input token in USD (or base currency). */
  inputCostPerToken?: number | null;
  /** Cost per cached input token read in USD (or base currency). */
  cacheReadCostPerToken?: number | null;
  /** Cost per cached input token write in USD (or base currency). */
  cacheWriteCostPerToken?: number | null;
  /** Cost per output token in USD (or base currency). */
  outputCostPerToken?: number | null;
  encrypted_reasoning?: string | null;
}

export interface ChatCompletionRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: LLMToolDefinition[];
}

export type LLMStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'thinking_signature'; signature: string }
  | { type: 'responses_reasoning_item'; item: ResponsesReasoningItem }
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

export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Result from applying a tool call delta to the accumulator.
 * - `accumulated`: Full current state of all tool calls (use for terminal state)
 * - `current`: Just this delta normalized to stable id/name (use for streaming)
 */
export interface ToolCallDeltaResult {
  accumulated: ToolCall[];
  current: { id: string; name: string; argumentsDelta: string };
}

/**
 * Accumulates streaming tool call deltas into complete tool calls.
 * Internal interface - not a stable public API.
 */
export interface ToolCallAccumulator {
  complete: ToolCall[];
  applyDelta(delta: { index: number; id?: string; name?: string; arguments?: string }): ToolCallDeltaResult;
}

export const reduceTextContent = (message: Message): string =>
  message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
