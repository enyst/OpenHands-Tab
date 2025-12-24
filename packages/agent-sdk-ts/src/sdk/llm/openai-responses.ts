import { setTimeout as delay } from 'node:timers/promises';
import type { Message, ResponsesReasoningItem, ToolCall } from '../types';
import { DEFAULT_PROVIDER_BASE_URLS } from './provider';
import { DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type LLMToolDefinition, type RetryOptions } from './types';

const mergeHeaders = (base?: Record<string, string>, overrides?: Record<string, string>): Record<string, string> => ({
  ...(base ?? {}),
  ...(overrides ?? {}),
});

const defaultBaseUrls: Record<string, string> = {
  openai: DEFAULT_PROVIDER_BASE_URLS.openai,
  openrouter: DEFAULT_PROVIDER_BASE_URLS.openrouter,
  litellm_proxy: DEFAULT_PROVIDER_BASE_URLS.litellm_proxy,
};

type ResponsesInputText = { type: 'input_text'; text: string };
type ResponsesOutputText = { type: 'output_text'; text: string };
type ResponsesInputImage = { type: 'input_image'; image_url: string; detail?: string };

type ResponsesMessageInputItem = {
  type: 'message';
  role: 'user' | 'assistant';
  content: Array<ResponsesInputText | ResponsesOutputText | ResponsesInputImage>;
};

type ResponsesFunctionCallInputItem = {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
};

type ResponsesFunctionCallOutputInputItem = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

type ResponsesReasoningInputItem = {
  type: 'reasoning';
  id: string;
  summary: Array<{ type: 'summary_text'; text: string }>;
  encrypted_content: string;
};

type ResponsesInputItem =
  | ResponsesMessageInputItem
  | ResponsesFunctionCallInputItem
  | ResponsesFunctionCallOutputInputItem
  | ResponsesReasoningInputItem;

type ResponsesToolParam = {
  type: 'function';
  name: string;
  description?: string;
  parameters?: unknown;
  strict: boolean;
};

type OpenAIResponsesUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

type OpenAIResponsesOutputItem =
  | {
    type: 'message';
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }
  | {
    type: 'function_call';
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: unknown;
  }
  | {
    type: 'reasoning';
    id?: string;
    summary?: Array<{ type?: string; text?: string }>;
    content?: Array<{ type?: string; text?: string }>;
    encrypted_content?: string;
    status?: string;
  }
  | Record<string, unknown>;

type OpenAIResponsesResponse = {
  output?: OpenAIResponsesOutputItem[];
  usage?: OpenAIResponsesUsage;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> => typeof candidate === 'object' && candidate !== null;

const normalizeToolCallId = (id: string): string => (id.startsWith('fc') ? id : `fc_${id}`);

const toResponsesTool = (tool: LLMToolDefinition): ResponsesToolParam => ({
  type: 'function',
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters,
  strict: false,
});

const toResponsesReasoningInputItem = (reasoning: ResponsesReasoningItem): ResponsesReasoningInputItem | undefined => {
  if (!reasoning.id) return undefined;

  // In stateless mode (store=false) we can only safely re-send reasoning items if the response included
  // `encrypted_content` (requested via include: ['reasoning.encrypted_content']). Otherwise OpenAI treats
  // the `rs_*` id as a server-stored reference and returns 404 when store=false.
  const encrypted = typeof reasoning.encrypted_content === 'string' ? reasoning.encrypted_content.trim() : '';
  if (!encrypted) return undefined;

  const summary = (reasoning.summary ?? []).map((text) => ({ type: 'summary_text' as const, text }));
  return {
    type: 'reasoning',
    id: reasoning.id,
    summary,
    encrypted_content: encrypted,
  };
};

const toResponsesInputItems = (messages: Message[]): ResponsesInputItem[] => {
  const items: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const content: ResponsesMessageInputItem['content'] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'input_text', text: part.text });
        } else if (part.type === 'image' && Array.isArray(part.image_urls)) {
          for (const imageUrl of part.image_urls) {
            content.push({ type: 'input_image', image_url: imageUrl, detail: 'auto' });
          }
        }
      }

      items.push({
        type: 'message',
        role: 'user',
        content: content.length ? content : [{ type: 'input_text', text: '' }],
      });
      continue;
    }

    if (message.role === 'assistant') {
      if (message.responses_reasoning_item) {
        const reasoningItem = toResponsesReasoningInputItem(message.responses_reasoning_item);
        if (reasoningItem) items.push(reasoningItem);
      }

      const content: ResponsesMessageInputItem['content'] = [];
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          content.push({ type: 'output_text', text: part.text });
        }
      }
      if (content.length) {
        items.push({
          type: 'message',
          role: 'assistant',
          content,
        });
      }

      if (Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const callId = normalizeToolCallId(toolCall.id);
          items.push({
            type: 'function_call',
            id: callId,
            call_id: callId,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      if (!message.tool_call_id) continue;
      const callId = normalizeToolCallId(message.tool_call_id);
      for (const part of message.content) {
        if (part.type === 'text') {
          items.push({
            type: 'function_call_output',
            call_id: callId,
            output: part.text,
          });
        }
      }
    }
  }

  return items;
};

const toRequestBody = (config: LLMConfiguration, request: ChatCompletionRequest) => ({
  model: config.model,
  instructions: request.systemPrompt,
  input: toResponsesInputItems(request.messages),
  include: ['reasoning.encrypted_content'],
  tools: request.tools?.length ? request.tools.map(toResponsesTool) : undefined,
  tool_choice: request.tools?.length ? 'auto' : undefined,
  store: false,
  temperature: config.temperature ?? undefined,
  max_output_tokens: config.maxOutputTokens ?? undefined,
  reasoning: config.reasoningEffort && config.reasoningEffort !== 'none'
    ? {
      effort: config.reasoningEffort,
      ...(config.reasoningSummary ? { summary: config.reasoningSummary } : {}),
    }
    : undefined,
});

const parseResponsesOutput = (output: unknown): { text?: string; toolCalls: ToolCall[]; responsesReasoningItem?: ResponsesReasoningItem } => {
  const assistantTextParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let responsesReasoningItem: ResponsesReasoningItem | undefined;

  if (!Array.isArray(output)) {
    return { toolCalls };
  }

  for (const item of output) {
    if (!isRecord(item)) continue;
    const type = item.type;
    if (type === 'message') {
      const content = item.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (part.type === 'output_text' && typeof part.text === 'string') {
          assistantTextParts.push(part.text);
        }
      }
      continue;
    }

    if (type === 'function_call') {
      const id = typeof item.call_id === 'string' && item.call_id ? item.call_id : (typeof item.id === 'string' ? item.id : '');
      const name = typeof item.name === 'string' ? item.name : '';
      const argumentsStr = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? '');
      if (!id) {
        throw new Error(`Responses function_call missing call_id/id: ${JSON.stringify(item)}`);
      }
      if (!name) {
        throw new Error(`Responses function_call missing name: ${JSON.stringify(item)}`);
      }
      toolCalls.push({
        id: String(id),
        type: 'function',
        function: {
          name: String(name),
          arguments: argumentsStr,
        },
      });
      continue;
    }

    if (type === 'reasoning') {
      const id = typeof item.id === 'string' ? item.id : '';
      if (!id) continue;
      const summary: string[] = [];
      if (Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (isRecord(s) && typeof s.text === 'string') summary.push(s.text);
        }
      }
      const content: string[] = [];
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (isRecord(c) && typeof c.text === 'string') content.push(c.text);
        }
      }
      responsesReasoningItem = {
        id,
        summary,
        content: content.length ? content : null,
        encrypted_content: typeof item.encrypted_content === 'string' ? item.encrypted_content : undefined,
        status: typeof item.status === 'string' ? item.status : undefined,
      };
    }
  }

  const text = assistantTextParts.join('\n').trim();
  return {
    ...(text ? { text } : {}),
    toolCalls,
    ...(responsesReasoningItem ? { responsesReasoningItem } : {}),
  };
};

const parseUsage = (usage: unknown): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } => {
  if (!isRecord(usage)) return {};

  const inputTokens = typeof usage.input_tokens === 'number'
    ? usage.input_tokens
    : (typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined);
  const outputTokens = typeof usage.output_tokens === 'number'
    ? usage.output_tokens
    : (typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined);

  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
  const cacheReadTokens = typeof inputDetails?.cached_tokens === 'number'
    ? inputDetails.cached_tokens
    : (typeof promptDetails?.cached_tokens === 'number' ? promptDetails.cached_tokens : undefined);

  return { inputTokens, outputTokens, cacheReadTokens };
};

export class OpenAIResponsesClient implements LLMClient {
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
    const { text, toolCalls, responsesReasoningItem } = parseResponsesOutput(response.output);
    const usage = parseUsage(response.usage);

    if (responsesReasoningItem) {
      yield { type: 'responses_reasoning_item', item: responsesReasoningItem };
    }

    if (text) {
      yield { type: 'text', text };
    }

    for (const toolCall of toolCalls) {
      yield { type: 'tool_call_delta', id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments };
    }

    if (usage.inputTokens || usage.outputTokens || usage.cacheReadTokens) {
      yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens };
    }

    yield { type: 'finish' };
  }

  private async fetchWithRetry(request: ChatCompletionRequest): Promise<OpenAIResponsesResponse> {
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
        const response = await fetch(this.requestUrl(), {
          method: 'POST',
          headers: this.requestHeaders(),
          body: JSON.stringify(toRequestBody(this.config, request)),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          if (this.retry.retryOn(response.status) && attempt < this.retry.maxRetries) {
            await delay(delayMs);
            delayMs = Math.min(this.retry.maxDelayMs, delayMs * 2);
            attempt += 1;
            continue;
          }
          const message = await response.text();
          throw new Error(`LLM request failed (${response.status}): ${message}`);
        }

        const json = await response.json() as unknown;
        if (!isRecord(json)) {
          throw new Error(`Responses API returned non-object payload: ${JSON.stringify(json)}`);
        }
        return json as OpenAIResponsesResponse;
      } catch (error) {
        lastError = error as Error;
        if (attempt >= this.retry.maxRetries) break;
        await delay(delayMs);
        delayMs = Math.min(this.retry.maxDelayMs, delayMs * 2);
        attempt += 1;
      }
    }

    throw lastError ?? new Error('LLM request failed after retries');
  }

  private requestUrl(): string {
    const providerBase = this.config.baseUrl || defaultBaseUrls[this.config.provider ?? 'openai'] || defaultBaseUrls.openai;
    const normalized = providerBase.endsWith('/') ? providerBase.slice(0, -1) : providerBase;
    const apiVersionSegment = this.config.apiVersion ? `?api-version=${encodeURIComponent(this.config.apiVersion)}` : '';
    return `${normalized}/responses${apiVersionSegment}`;
  }

  private requestHeaders(): Record<string, string> {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.config.provider === 'openrouter') {
      baseHeaders['HTTP-Referer'] = 'https://openhands.io';
      baseHeaders['X-Title'] = 'OpenHands';
    }

    return mergeHeaders(baseHeaders, this.config.headers);
  }
}
