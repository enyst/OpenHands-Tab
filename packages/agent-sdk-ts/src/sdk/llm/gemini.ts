import { DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type RetryOptions } from './types';
import type { Content, Message, ToolCall } from '../types';
import { DEFAULT_PROVIDER_BASE_URLS } from './provider';

/**
 * Gemini Client
 * 
 * Supports Gemini 3 models with extended thinking (thought signatures).
 * 
 * API Documentation:
 * - Gemini Thought Signatures: https://ai.google.dev/gemini-api/docs/thought-signatures
 * - Gemini 3 Models: https://ai.google.dev/gemini-api/docs/gemini-3
 * 
 * Key Gemini 3 Thinking Quirks:
 * - thoughtSignature MUST be passed back during function calling (400 error otherwise)
 * - For parallel function calls, only the FIRST function call has the signature
 * - For sequential function calls, ALL signatures must be preserved
 * - Non-function-call responses may have optional signatures (recommended to preserve)
 * - thinkingLevel can be: 'NONE', 'LOW', 'MEDIUM', 'HIGH'
 */

const decoder = new TextDecoder();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class NonRetryableHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'NonRetryableHttpStatusError';
    this.status = status;
  }
}

type GeminiRole = 'user' | 'model';

type GeminiPart =
  | { text: string; thoughtSignature?: string }
  | { functionCall: { name: string; args?: unknown }; thoughtSignature?: string }
  | { functionResponse: { name: string; response?: unknown } };

type GeminiContent = {
  role: GeminiRole;
  parts: GeminiPart[];
};

type GeminiFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: unknown;
};

// Gemini thinking levels map to reasoningEffort
type GeminiThinkingLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

type GeminiGenerateContentRequest = {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' } };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    thinkingConfig?: {
      thinkingLevel: GeminiThinkingLevel;
      // Enable thought summaries in response
      // See: https://ai.google.dev/gemini-api/docs/thinking#thought_summaries
      includeThoughts?: boolean;
    };
  };
};

type GeminiStreamCandidatePart =
  | { text?: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall?: { name?: string; args?: unknown }; thoughtSignature?: string };

type GeminiStreamResponse = {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: GeminiStreamCandidatePart[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

const normalizeUrl = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
};

const reduceTextContent = (content: Content[]): string =>
  content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

const toGeminiPartsForMessage = (message: Message): GeminiPart[] => {
  if (message.role === 'tool') {
    const toolName = (message.name ?? '').trim() || 'unknown_tool';
    const text = reduceTextContent(message.content).trim();
    return [
      {
        functionResponse: {
          name: toolName,
          response: {
            content: text,
            ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          },
        },
      },
    ];
  }

  const parts: GeminiPart[] = [];

  // Add text content with optional thought signature
  // Gemini 3 requires thoughtSignature to be preserved on text parts
  for (const item of message.content) {
    if (item.type === 'text') {
      const part: GeminiPart = { text: item.text };
      // Preserve thinking_signature if present (from previous assistant response)
      if (message.thinking_signature) {
        part.thoughtSignature = message.thinking_signature;
      }
      parts.push(part);
    }
  }

  // Add function calls with thought signatures
  // Gemini 3 requires thoughtSignature on the FIRST function call in each step
  if (Array.isArray(message.tool_calls)) {
    for (let i = 0; i < message.tool_calls.length; i++) {
      const call = message.tool_calls[i];
      const args = (() => {
        const raw = typeof call.function.arguments === 'string' ? call.function.arguments : '';
        if (!raw.trim()) return {};
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return { __raw: raw };
        }
      })();
      const part: GeminiPart = { functionCall: { name: call.function.name, args } };
      // Preserve thinking_signature on the first function call (Gemini requirement)
      if (i === 0 && message.thinking_signature) {
        part.thoughtSignature = message.thinking_signature;
      }
      parts.push(part);
    }
  }

  return parts;
};

const toGeminiContents = (messages: Message[]): GeminiContent[] => {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      // System prompt is handled separately as systemInstruction.
      continue;
    }

    const parts = toGeminiPartsForMessage(message);
    if (!parts.length) continue;

    const role: GeminiRole = message.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts });
  }
  return contents;
};

/**
 * Recursively strip unsupported JSON Schema properties for Gemini.
 * Gemini's function calling API rejects additionalProperties and other
 * OpenAI-style schema fields that zod-to-json-schema adds automatically.
 */
export const stripUnsupportedSchemaProps = (schema: unknown): unknown => {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(stripUnsupportedSchemaProps);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    // Skip properties Gemini doesn't support
    if (key === 'additionalProperties') continue;
    result[key] = stripUnsupportedSchemaProps(value);
  }
  return result;
};

const toGeminiTools = (tools: ChatCompletionRequest['tools']): GeminiGenerateContentRequest['tools'] | undefined => {
  if (!tools?.length) return undefined;
  const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: stripUnsupportedSchemaProps(tool.function.parameters),
  }));
  return [{ functionDeclarations }];
};

/**
 * Map reasoningEffort to Gemini thinkingLevel
 * See: https://ai.google.dev/gemini-api/docs/thought-signatures
 */
const toGeminiThinkingLevel = (reasoningEffort: LLMConfiguration['reasoningEffort']): GeminiThinkingLevel | undefined => {
  if (!reasoningEffort || reasoningEffort === 'none') return undefined;
  switch (reasoningEffort) {
    case 'low': return 'LOW';
    case 'medium': return 'MEDIUM';
    case 'high': return 'HIGH';
    default: return undefined;
  }
};

const toRequestBody = (config: LLMConfiguration, request: ChatCompletionRequest): GeminiGenerateContentRequest => {
  const systemPrompt = typeof request.systemPrompt === 'string' ? request.systemPrompt.trim() : '';
  const tools = toGeminiTools(request.tools);
  const thinkingLevel = toGeminiThinkingLevel(config.reasoningEffort);
  
  const generationConfig: GeminiGenerateContentRequest['generationConfig'] = {
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
    topP: typeof config.topP === 'number' ? config.topP : undefined,
    topK: typeof config.topK === 'number' ? config.topK : undefined,
    maxOutputTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined,
    // Enable thinking for Gemini 3 models when reasoningEffort is set
    // includeThoughts enables thought summaries in the response
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel, includeThoughts: true } } : {}),
  };

  const body: GeminiGenerateContentRequest = {
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    contents: toGeminiContents(request.messages),
    ...(tools ? { tools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    ...(Object.values(generationConfig).some((value) => value !== undefined) ? { generationConfig } : {}),
  };
  return body;
};

const parseSseLines = async function* (response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) yield payload;
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
  if (buffer.length) {
    const payload = buffer.replace(/^data:/, '').trim();
    if (payload) yield payload;
  }
};

const normalizeToolCall = (call: { name?: string; args?: unknown }, index: number): ToolCall => ({
  id: `gemini_call_${index}`,
  type: 'function',
  function: {
    name: typeof call.name === 'string' ? call.name : '',
    arguments: JSON.stringify(call.args ?? {}),
  },
});

export class GeminiClient implements LLMClient {
  private readonly config: LLMConfiguration;
  private readonly apiKey: string;
  private readonly retry: RetryOptions;

  constructor(config: LLMConfiguration, apiKey: string, retry: RetryOptions = DEFAULT_RETRY_OPTIONS) {
    this.config = config;
    this.apiKey = apiKey;
    this.retry = retry;
  }

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const response = await this.fetchWithRetry(request);

    let emittedText = '';
    let toolCallIndex = 0;
    let finished = false;

    for await (const payload of parseSseLines(response)) {
      if (payload === '[DONE]') {
        yield { type: 'finish' };
        finished = true;
        break;
      }

      let parsed: GeminiStreamResponse;
      try {
        parsed = JSON.parse(payload) as GeminiStreamResponse;
      } catch {
        continue;
      }

      const parts = parsed.candidates?.[0]?.content?.parts ?? [];

      for (const part of parts) {
        // Extract thoughtSignature from any part (text or functionCall)
        // Gemini 3 returns thoughtSignature on the first functionCall or on text parts
        const signature = 'thoughtSignature' in part ? part.thoughtSignature : undefined;
        if (signature) {
          yield { type: 'thinking_signature', signature };
        }

        // Handle text parts - check if it's a thought summary or regular text
        if ('text' in part && typeof part.text === 'string' && part.text) {
          const isThought = 'thought' in part && part.thought === true;
          if (isThought) {
            // Thought summary - emit as reasoning
            yield { type: 'reasoning', reasoning: part.text };
          } else {
            // Regular text - emit as text with delta tracking
            const delta = part.text.startsWith(emittedText) ? part.text.slice(emittedText.length) : part.text;
            if (delta) {
              emittedText = part.text.startsWith(emittedText) ? part.text : `${emittedText}${delta}`;
              yield { type: 'text', text: delta };
            }
          }
        }

        // Handle function calls
        const call = 'functionCall' in part ? (part.functionCall ?? undefined) : undefined;
        if (!call || typeof call !== 'object') continue;
        const toolCall = normalizeToolCall(call, toolCallIndex);
        toolCallIndex += 1;
        yield { type: 'tool_call_delta', id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments };
      }

      const usage = parsed.usageMetadata;
      if (usage && (typeof usage.promptTokenCount === 'number' || typeof usage.candidatesTokenCount === 'number')) {
        yield { type: 'usage', inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount };
      }
    }

    if (!finished) {
      yield { type: 'finish' };
    }
  }

  private requestUrl(): string {
    const baseUrl = normalizeUrl(this.config.baseUrl) ?? normalizeUrl(DEFAULT_PROVIDER_BASE_URLS.gemini) ?? DEFAULT_PROVIDER_BASE_URLS.gemini;
    return `${baseUrl}/models/${encodeURIComponent(this.config.model)}:streamGenerateContent?alt=sse`;
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(this.config.headers ?? {}),
      'x-goog-api-key': this.apiKey,
    };
    return headers;
  }

  private async fetchWithRetry(request: ChatCompletionRequest): Promise<Response> {
    let attempt = 0;
    let delayMs = this.retry.baseDelayMs;
    let lastError: Error | undefined;

    while (attempt <= this.retry.maxRetries) {
      try {
        const controller = new AbortController();
        const effectiveSeconds = (typeof this.config.timeoutSeconds === 'number' && this.config.timeoutSeconds > 0)
          ? this.config.timeoutSeconds
          : (DEFAULT_TIMEOUT_MS / 1000);
        const timeout = setTimeout(() => controller.abort(), effectiveSeconds * 1000);
        let response: Response;
        try {
          response = await fetch(this.requestUrl(), {
            method: 'POST',
            headers: this.requestHeaders(),
            body: JSON.stringify(toRequestBody(this.config, request)),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          const shouldRetry = this.retry.retryOn(response.status) && attempt < this.retry.maxRetries;
          if (shouldRetry) {
            await delay(delayMs);
            delayMs = Math.min(this.retry.maxDelayMs, delayMs * 2);
            attempt += 1;
            continue;
          }
          const detail = await response.text().catch(() => '');
          throw new NonRetryableHttpStatusError(response.status, `LLM request failed (HTTP ${response.status}): ${detail.slice(0, 500)}`);
        }

        return response;
      } catch (err) {
        if (err instanceof NonRetryableHttpStatusError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= this.retry.maxRetries) break;
        await delay(delayMs);
        delayMs = Math.min(this.retry.maxDelayMs, delayMs * 2);
        attempt += 1;
      }
    }

    throw lastError ?? new Error('LLM request failed');
  }
}
