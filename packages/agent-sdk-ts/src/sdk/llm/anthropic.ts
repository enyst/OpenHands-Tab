import { setTimeout as delay } from 'node:timers/promises';
import { reduceTextContent, DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type RetryOptions } from './types';

const decoder = new TextDecoder();

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  name?: string;
}

type AnthropicEventName = 'message_start' | 'content_block_delta' | 'message_delta' | (string & {});

interface AnthropicMessageStartEvent {
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface AnthropicContentDeltaEvent {
  delta?: { type?: string; text?: string };
}

interface AnthropicMessageDeltaEvent {
  delta?: { stop_reason?: string };
}

const isMessageStartEvent = (data: unknown): data is AnthropicMessageStartEvent =>
  typeof data === 'object' && data !== null && 'message' in data;

const isContentDeltaEvent = (data: unknown): data is AnthropicContentDeltaEvent =>
  typeof data === 'object' && data !== null && 'delta' in data;

const isMessageDeltaEvent = (data: unknown): data is AnthropicMessageDeltaEvent =>
  typeof data === 'object' && data !== null && 'delta' in data;

const toAnthropicMessages = (request: ChatCompletionRequest): AnthropicMessage[] =>
  request.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role as AnthropicMessage['role'],
      content: [{ type: 'text', text: reduceTextContent(message) }],
      name: message.name,
    }));

const parseAnthropicStream = async function* (response: Response): AsyncGenerator<{ event?: AnthropicEventName; data?: unknown }> {
  const reader = response.body?.getReader();
  if (!reader) return;

  let buffer = '';
  let currentEvent: string | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      }
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) {
          try {
            yield { event: currentEvent, data: JSON.parse(payload) };
          } catch {
            yield { event: currentEvent };
          }
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
};

export class AnthropicClient implements LLMClient {
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
    for await (const { event, data } of parseAnthropicStream(response)) {
      if (!data) continue;
      switch (event) {
        case 'message_start':
          if (isMessageStartEvent(data) && data.message?.usage) {
            yield {
              type: 'usage',
              inputTokens: data.message.usage.input_tokens,
              outputTokens: data.message.usage.output_tokens,
              cacheWriteTokens: data.message.usage.cache_creation_input_tokens,
              cacheReadTokens: data.message.usage.cache_read_input_tokens,
            };
          }
          break;
        case 'content_block_delta':
          if (isContentDeltaEvent(data) && data.delta?.type === 'text_delta' && data.delta.text) {
            yield { type: 'text', text: data.delta.text };
          }
          break;
        case 'message_delta':
          if (isMessageDeltaEvent(data) && data.delta?.stop_reason) {
            yield { type: 'finish', finishReason: data.delta.stop_reason };
          }
          break;
        default:
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
          body: JSON.stringify(this.requestBody(request)),
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
          throw new Error(`Anthropic request failed (${response.status}): ${message}`);
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

    throw lastError ?? new Error('Anthropic request failed after retries');
  }

  private requestUrl(): string {
    const base = this.config.baseUrl || 'https://api.anthropic.com/v1';
    const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${normalized}/messages`;
  }

  private requestHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.config.apiVersion || '2023-06-01',
      ...this.config.headers,
    };
  }

  private requestBody(request: ChatCompletionRequest): Record<string, unknown> {
    return {
      model: this.config.model,
      max_tokens: this.config.maxOutputTokens ?? 1024,
      temperature: this.config.temperature ?? 0,
      system: [{ type: 'text', text: request.systemPrompt }],
      messages: toAnthropicMessages(request),
      stream: true,
      thinking: this.config.reasoningEffort && this.config.reasoningEffort !== 'none'
        ? { type: 'enabled', budget_tokens: this.config.maxOutputTokens ?? undefined }
        : undefined,
    };
  }
}
