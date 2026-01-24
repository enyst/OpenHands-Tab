import { setTimeout as delay } from 'node:timers/promises';
import { reduceTextContent, DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type RetryOptions, type ToolCallAccumulator } from './types';
import { DEFAULT_PROVIDER_BASE_URLS } from './provider';
import { supportsThinkingBlocks } from './providerQuirks';
import { buildOpenAiHeaders } from './openaiHeaders';

const decoder = new TextDecoder();

class NonRetryableHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'NonRetryableHttpStatusError';
    this.status = status;
  }
}

type OpenAIThinkingContentBlock = {
  type: 'thinking';
  thinking: string;
  signature?: string;
};

type OpenAITextContentBlock = {
  type: 'text';
  text: string;
};

type OpenAIImageUrlContentBlock = {
  type: 'image_url';
  image_url: { url: string; detail?: string };
};

type OpenAIToolUseContentBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
};

type OpenAIContentBlock = OpenAIThinkingContentBlock | OpenAITextContentBlock | OpenAIImageUrlContentBlock | OpenAIToolUseContentBlock;

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentBlock[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatCompletionRequest['messages'][number]['tool_calls'];
};

type OpenAIThinkingBlock = {
  type: 'thinking';
  thinking?: string;
  signature?: string;
};

type OpenAIContentPart =
  | { type: 'text'; text?: string }
  | OpenAIThinkingBlock;

type OpenAIToolCallDelta = {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
};

type OpenAIChoiceDelta = {
  content?: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCallDelta[];
  reasoning_content?: string | { text?: string }[];
  /** Anthropic thinking blocks (via LiteLLM) - contains signature at the end */
  thinking_blocks?: OpenAIThinkingBlock[];
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

/**
 * Convert internal message format to OpenAI-compatible format.
 * When targeting Anthropic models (via LiteLLM), includes thinking blocks in content.
 * 
 * IMPORTANT: LiteLLM expects OpenAI format with tool_calls, NOT Anthropic format with
 * tool_use blocks in content. LiteLLM converts tool_calls to tool_use when proxying to Anthropic.
 * However, thinking blocks must be sent in the content array since there's no OpenAI equivalent.
 */
const toOpenAIMessage = (message: ChatCompletionRequest['messages'][number], config: LLMConfiguration): OpenAIChatMessage => {
  const contentText = reduceTextContent(message);

  // For Anthropic models with thinking enabled: include thinking blocks in content array
  // This is required when assistant messages have thinking content that needs to be preserved.
  // IMPORTANT: Anthropic API requires the `signature` field when sending thinking blocks,
  // so we only include thinking blocks when we have BOTH reasoning_content AND thinking_signature.
  // However, keep in mind that it REQUIRES thinking blocks when reasoningEffort/extended thinking is enabled.
  const includeThinkingBlocks = supportsThinkingBlocks(config);

  if (includeThinkingBlocks && message.role === 'assistant' && message.reasoning_content && message.thinking_signature) {
    // For Anthropic via LiteLLM proxy: send thinking in content array, tool_calls separately
    // LiteLLM will convert tool_calls to tool_use blocks when sending to Anthropic
    const contentBlocks: OpenAIContentBlock[] = [];

    // Thinking block must come first (signature is required by Anthropic)
    contentBlocks.push({
      type: 'thinking',
      thinking: message.reasoning_content,
      signature: message.thinking_signature,
    });

    // Then text content (if any)
    if (contentText) {
      contentBlocks.push({ type: 'text', text: contentText });
    }

    // Return with content array for thinking, but tool_calls in OpenAI format
    // LiteLLM will merge these appropriately when converting to Anthropic format
    const result: OpenAIChatMessage = {
      role: 'assistant',
      content: contentBlocks,
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    return result;
  }

  // User messages: include image_url blocks when present.
  if (message.role === 'user') {
    const blocks: OpenAIContentBlock[] = [];
    for (const part of message.content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
        continue;
      }
      if (part.type === 'image' && Array.isArray(part.image_urls)) {
        for (const url of part.image_urls) {
          blocks.push({ type: 'image_url', image_url: { url, detail: part.detail ?? 'auto' } });
        }
      }
    }
    if (blocks.some((b) => b.type === 'image_url')) {
      if (!blocks.some((b) => b.type === 'text')) {
        blocks.unshift({ type: 'text', text: '' });
      }
      return { role: 'user', content: blocks };
    }
  }

  // Standard case: plain text content (for non-Anthropic models or messages without thinking)
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
    ...request.messages.map((msg) => toOpenAIMessage(msg, config)),
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
  openai: DEFAULT_PROVIDER_BASE_URLS.openai,
  openrouter: DEFAULT_PROVIDER_BASE_URLS.openrouter,
  litellm_proxy: DEFAULT_PROVIDER_BASE_URLS.litellm_proxy,
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
    // OpenAI only sends id in first delta; fall back to synthetic id so orchestrator can track calls
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
      } else if (part?.type === 'thinking') {
        // Handle thinking blocks from LiteLLM (content array format)
        if (part.thinking) {
          deltas.push({ type: 'reasoning', reasoning: part.thinking });
        }
        if (part.signature) {
          deltas.push({ type: 'thinking_signature', signature: part.signature });
        }
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
      // Yield only the delta, not accumulated arguments (streamer will accumulate)
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

  // Handle thinking_blocks from LiteLLM (signature is in the final thinking_block).
  // IMPORTANT: Only extract the signature here, NOT the thinking content.
  // LiteLLM streams reasoning via delta.reasoning_content (handled above), and then
  // sends thinking_blocks in a final chunk with the signature. If we also pushed
  // block.thinking here, reasoning would be accumulated twice and get mangled.
  if (Array.isArray(delta.thinking_blocks)) {
    for (const block of delta.thinking_blocks) {
      if (block?.type === 'thinking' && block.signature) {
        deltas.push({ type: 'thinking_signature', signature: block.signature });
      }
    }
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
      } catch {
        // Skip malformed chunks rather than terminating entire stream.
        // Proxies or providers may occasionally send bad data; we prefer
        // resilience over failing fast since partial responses are still useful.
        continue;
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
          throw new NonRetryableHttpStatusError(response.status, `LLM request failed (${response.status}): ${message}`);
        }

        return response;
      } catch (error) {
        if (error instanceof NonRetryableHttpStatusError) {
          throw error;
        }
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
    return buildOpenAiHeaders({
      apiKey: this.apiKey,
      provider: this.config.provider,
      headers: this.config.headers,
    });
  }
}
