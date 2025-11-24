import { setTimeout as delay } from 'node:timers/promises';
import { reduceTextContent, DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type RetryOptions, type ToolCallAccumulator } from './types';

const decoder = new TextDecoder();

const mergeHeaders = (base?: Record<string, string>, overrides?: Record<string, string>): Record<string, string> => ({
  ...(base ?? {}),
  ...(overrides ?? {}),
});

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionRequest['messages'][number]['tool_calls'];
};

type OpenAIContentPart = { type: 'text'; text?: string };

type OpenAIToolCallDelta = {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
};

type OpenAIChoiceDelta = {
  content?: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCallDelta[];
  reasoning_content?: string | { text?: string }[];
};

type OpenAIChoice = {
  delta?: OpenAIChoiceDelta;
  finish_reason?: string | null;
};

type OpenAIStreamChunk = {
  choices?: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

const isOpenAIStreamChunk = (value: unknown): value is OpenAIStreamChunk =>
  typeof value === 'object' && value !== null && ('choices' in value || 'usage' in value);

const toOpenAIMessage = (message: ChatCompletionRequest['messages'][number]): OpenAIChatMessage => {
  const contentText = reduceTextContent(message);
  const base: OpenAIChatMessage = {
    role: message.role,
    content: contentText,
  };
  if (message.name) base.name = message.name;
  if (message.tool_call_id) base.tool_call_id = message.tool_call_id;
  if (message.role === 'assistant' && message.tool_calls) base.tool_calls = message.tool_calls;
  return base;
};

const toRequestBody = (config: LLMConfiguration, request: ChatCompletionRequest) => ({
  model: config.model,
  messages: [
    {
      role: 'system',
      content: request.systemPrompt,
    },
    ...request.messages.map(toOpenAIMessage),
  ],
  stream: true,
  stream_options: { include_usage: true },
  temperature: config.temperature ?? undefined,
  // Do not send top_p or top_k for OpenAI-compatible endpoints to avoid proxy/model rejections
  // top_p and top_k intentionally omitted
  max_tokens: config.maxOutputTokens ?? undefined,
  reasoning_effort: config.reasoningEffort && config.reasoningEffort !== 'none' ? config.reasoningEffort : undefined,
  tools: request.tools,
  tool_choice: request.tools?.length ? 'auto' : undefined,
});

const defaultBaseUrls: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  litellm_proxy: 'http://localhost:4000',
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
        if (payload) {
          yield payload;
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
  if (buffer.length) {
    const payload = buffer.replace(/^data:/, '').trim();
    if (payload) yield payload;
  }
};

class OpenAIToolCallAccumulator implements ToolCallAccumulator {
  complete = [] as ToolCallAccumulator['complete'];
  // Track by index since that's always present in streaming, but store the real id
  private readonly partial = new Map<number, { id: string; name?: string; arguments: string }>();

  applyDelta(delta: { index: number; id?: string; name?: string; arguments?: string }): { accumulated: ToolCallAccumulator['complete']; current: { id: string; name: string; argumentsDelta: string } } {
    const existing = this.partial.get(delta.index);
    const id = delta.id ?? existing?.id ?? `tool_call_${delta.index}`;
    const updated = {
      id,
      name: delta.name ?? existing?.name,
      arguments: `${existing?.arguments ?? ''}${delta.arguments ?? ''}`,
    };
    this.partial.set(delta.index, updated);

    this.complete = Array.from(this.partial.values()).map((value) => ({
      id: value.id,
      type: 'function',
      function: { name: value.name ?? '', arguments: value.arguments },
    }));

    return {
      accumulated: this.complete,
      current: {
        id,
        name: updated.name ?? '',
        argumentsDelta: delta.arguments ?? '',
      },
    };
  }
}

const mapChunkToStream = (chunk: OpenAIStreamChunk, accumulator: OpenAIToolCallAccumulator): LLMStreamChunk[] => {
  const choice = chunk?.choices?.[0];
  if (!choice) return [];
  const deltas: LLMStreamChunk[] = [];

  const delta = choice.delta ?? {};
  const content = delta.content;
  if (typeof content === 'string') {
    deltas.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        deltas.push({ type: 'text', text: part.text });
      }
    }
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      // Index should always be present per OpenAI spec; skip malformed deltas
      if (typeof call.index !== 'number') {
        continue;
      }
      const result = accumulator.applyDelta({
        index: call.index,
        id: call.id,
        name: call.function?.name,
        arguments: call.function?.arguments,
      });
      // Yield only the delta, not accumulated arguments (orchestrator will accumulate)
      deltas.push({
        type: 'tool_call_delta',
        id: result.current.id,
        name: result.current.name,
        arguments: result.current.argumentsDelta,
      });
    }
  }

  if (delta.reasoning_content) {
    const reasoning = Array.isArray(delta.reasoning_content)
      ? delta.reasoning_content.map((entry) => entry?.text ?? '').join('')
      : String(delta.reasoning_content ?? '');
    if (reasoning) deltas.push({ type: 'reasoning', reasoning });
  }

  if (chunk.usage) {
    deltas.push({
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
      cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
    });
  }

  if (choice.finish_reason) {
    deltas.push({ type: 'finish', finishReason: choice.finish_reason });
  }

  return deltas;
};

export class OpenAICompatibleClient implements LLMClient {
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
    const accumulator = new OpenAIToolCallAccumulator();

    for await (const payload of parseSseLines(response)) {
      if (payload === '[DONE]') {
        yield { type: 'finish' };
        break;
      }

      try {
        const json = JSON.parse(payload) as unknown;
        if (!isOpenAIStreamChunk(json)) continue;
        const mapped = mapChunkToStream(json, accumulator);
        for (const item of mapped) {
          yield item;
        }
      } catch (error) {
        yield { type: 'finish', finishReason: (error as Error).message };
        break;
      }
    }
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

        return response;
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
    return `${normalized}/chat/completions${apiVersionSegment}`;
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
