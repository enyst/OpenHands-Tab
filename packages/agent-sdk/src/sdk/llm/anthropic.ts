import { reduceTextContent, DEFAULT_RETRY_OPTIONS, DEFAULT_TIMEOUT_MS, type ChatCompletionRequest, type LLMClient, type LLMConfiguration, type LLMStreamChunk, type LLMToolDefinition, type RetryOptions, type ToolCallAccumulator } from './types';
import { getAnthropicThinkingBudget, supportsPromptCaching } from './providerQuirks';
import { NonRetryableHttpStatusError, requestWithRetry } from './httpRetry';

const decoder = new TextDecoder();
const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const;

type AnthropicCacheControl = typeof EPHEMERAL_CACHE_CONTROL;

// Anthropic content block types
type AnthropicThinkingBlock = {
  type: 'thinking';
  thinking: string;
  signature?: string;
};

type AnthropicTextBlock = {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
};

type AnthropicToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
};

type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: AnthropicCacheControl;
};

type AnthropicImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
  cache_control?: AnthropicCacheControl;
};

type AnthropicContentBlock =
  | AnthropicThinkingBlock
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type AnthropicEventName = 'message_start' | 'content_block_start' | 'content_block_delta' | 'message_delta' | (string & {});

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

interface AnthropicContentBlockStartEvent {
  index: number;
  content_block?: {
    type: 'text' | 'tool_use' | 'thinking';
    id?: string;
    name?: string;
    signature?: string;
  };
}

interface AnthropicContentDeltaEvent {
  index: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
  };
}

interface AnthropicMessageDeltaEvent {
  delta?: { stop_reason?: string };
  usage?: { output_tokens?: number };
}

const isMessageStartEvent = (data: unknown): data is AnthropicMessageStartEvent =>
  typeof data === 'object' && data !== null && 'message' in data;

const isContentBlockStartEvent = (data: unknown): data is AnthropicContentBlockStartEvent =>
  typeof data === 'object' && data !== null && 'index' in data && 'content_block' in data;

const isContentDeltaEvent = (data: unknown): data is AnthropicContentDeltaEvent =>
  typeof data === 'object' && data !== null && 'delta' in data && 'index' in data && typeof (data as { index: unknown }).index === 'number';

const isMessageDeltaEvent = (data: unknown): data is AnthropicMessageDeltaEvent =>
  typeof data === 'object' && data !== null && 'delta' in data;

// Tool call accumulator for Anthropic streaming
class AnthropicToolCallAccumulator implements ToolCallAccumulator {
  complete = [] as ToolCallAccumulator['complete'];
  private readonly partial = new Map<number, { id: string; name: string; arguments: string }>();

  applyDelta(delta: { index: number; id?: string; name?: string; arguments?: string }): { accumulated: ToolCallAccumulator['complete']; current: { id: string; name: string; argumentsDelta: string } } {
    const existing = this.partial.get(delta.index);
    const id = delta.id ?? existing?.id ?? `tool_call_${delta.index}`;
    const name = delta.name ?? existing?.name ?? '';
    const updated = {
      id,
      name,
      arguments: `${existing?.arguments ?? ''}${delta.arguments ?? ''}`,
    };
    this.partial.set(delta.index, updated);

    this.complete = Array.from(this.partial.values()).map((value) => ({
      id: value.id,
      type: 'function',
      function: { name: value.name, arguments: value.arguments },
    }));

    return {
      accumulated: this.complete,
      current: {
        id,
        name,
        argumentsDelta: delta.arguments ?? '',
      },
    };
  }
}

const parseBase64DataUrl = (url: string): { mediaType: string; base64: string } | null => {
  const raw = typeof url === 'string' ? url.trim() : '';
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match) return null;
  return { mediaType: match[1].toLowerCase(), base64: match[2] };
};

const toAnthropicMessages = (
  request: ChatCompletionRequest,
  options?: { cacheLastMessage?: boolean },
): AnthropicMessage[] => {
  const result: AnthropicMessage[] = [];
  const lastCacheableMessageIndex = options?.cacheLastMessage
    ? (() => {
        for (let index = request.messages.length - 1; index >= 0; index -= 1) {
          const role = request.messages[index]?.role;
          if (role === 'user' || role === 'tool') {
            return index;
          }
        }
        return -1;
      })()
    : -1;

  for (const [index, message] of request.messages.entries()) {
    const shouldCacheMessage = index === lastCacheableMessageIndex;
    if (message.role === 'user') {
      const contentBlocks: AnthropicContentBlock[] = [];
      for (const part of message.content) {
        if (part.type === 'text') {
          contentBlocks.push({ type: 'text', text: part.text });
          continue;
        }
        if (part.type === 'image' && Array.isArray(part.image_urls)) {
          for (const url of part.image_urls) {
            const parsed = parseBase64DataUrl(url);
            if (!parsed) continue;
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 },
            });
          }
        }
      }
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: 'text', text: '' });
      }
      const lastBlock = contentBlocks.at(-1);
      if (
        shouldCacheMessage &&
        lastBlock &&
        (lastBlock.type === 'text' || lastBlock.type === 'image')
      ) {
        lastBlock.cache_control = EPHEMERAL_CACHE_CONTROL;
      }
      result.push({ role: 'user', content: contentBlocks });
    } else if (message.role === 'assistant') {
      // Assistant messages: may have thinking + tool_use
      const contentBlocks: AnthropicContentBlock[] = [];

      // Thinking block must come first if present.
      // IMPORTANT: Anthropic API requires the `signature` field when sending thinking blocks,
      // so we only include thinking blocks when we have BOTH reasoning_content AND thinking_signature.
      // However, keep in mind that it REQUIRES thinking blocks when reasoningEffort/extended thinking are enabled.
      if (message.reasoning_content && message.thinking_signature) {
        contentBlocks.push({
          type: 'thinking',
          thinking: message.reasoning_content,
          signature: message.thinking_signature,
        });
      }

      // Text content
      const textContent = reduceTextContent(message);
      if (textContent) {
        contentBlocks.push({ type: 'text', text: textContent });
      }

      // Tool use blocks
      if (message.tool_calls?.length) {
        for (const toolCall of message.tool_calls) {
          let input: unknown;
          try {
            input = JSON.parse(toolCall.function.arguments);
          } catch {
            input = toolCall.function.arguments;
          }
          contentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input,
          });
        }
      }

      // Only add message if there's content
      if (contentBlocks.length > 0) {
        result.push({
          role: 'assistant',
          content: contentBlocks,
        });
      }
    } else if (message.role === 'tool') {
      // Tool results must be sent as user messages with tool_result content
      // Find the last user message or create a new one
      const lastMessage = result[result.length - 1];
      const toolResultBlock: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id ?? '',
        content: reduceTextContent(message),
        ...(shouldCacheMessage ? { cache_control: EPHEMERAL_CACHE_CONTROL } : {}),
      };

      if (lastMessage?.role === 'user') {
        // Append to existing user message
        lastMessage.content.push(toolResultBlock);
      } else {
        // Create new user message
        result.push({
          role: 'user',
          content: [toolResultBlock],
        });
      }
    }
    // Skip 'system' role - handled separately
  }

  return result;
};

// Convert OpenAI tool definitions to Anthropic format
const toAnthropicTools = (tools?: LLMToolDefinition[]): Array<{ name: string; description?: string; input_schema: unknown }> | undefined => {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
  }));
};

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
    const accumulator = new AnthropicToolCallAccumulator();
    // Track which content block indices are tool_use blocks
    const toolBlockIndices = new Map<number, { id: string; name: string }>();

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
        case 'content_block_start':
          if (isContentBlockStartEvent(data)) {
            const block = data.content_block;
            if (block?.type === 'tool_use' && block.id && block.name) {
              // Register this index as a tool_use block
              toolBlockIndices.set(data.index, { id: block.id, name: block.name });
              // Emit initial tool call delta with id and name
              accumulator.applyDelta({ index: data.index, id: block.id, name: block.name });
              yield {
                type: 'tool_call_delta',
                id: block.id,
                name: block.name,
                arguments: '',
              };
            }
          }
          break;
        case 'content_block_delta':
          if (isContentDeltaEvent(data)) {
            const delta = data.delta;
            const index = data.index;

            if (delta?.type === 'text_delta' && delta.text) {
              yield { type: 'text', text: delta.text };
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              yield { type: 'reasoning', reasoning: delta.thinking };
            } else if (delta?.type === 'signature_delta' && delta.signature) {
              yield { type: 'thinking_signature', signature: delta.signature };
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              // Tool call argument delta
              const toolInfo = toolBlockIndices.get(index);
              if (toolInfo) {
                const result = accumulator.applyDelta({
                  index,
                  arguments: delta.partial_json,
                });
                yield {
                  type: 'tool_call_delta',
                  id: result.current.id,
                  name: result.current.name,
                  arguments: result.current.argumentsDelta,
                };
              }
            }
          }
          break;
        case 'message_delta':
          if (isMessageDeltaEvent(data)) {
            // Anthropic sends output_tokens in message_delta
            if (data.usage?.output_tokens) {
              yield {
                type: 'usage',
                outputTokens: data.usage.output_tokens,
              };
            }
            if (data.delta?.stop_reason) {
              yield { type: 'finish', finishReason: data.delta.stop_reason };
            }
          }
          break;
        default:
          break;
      }
    }
  }

  private async fetchWithRetry(request: ChatCompletionRequest): Promise<Response> {
    return requestWithRetry<Response>({
      retry: this.retry,
      timeoutSeconds: this.config.timeoutSeconds,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      request: (signal) => fetch(this.requestUrl(), {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(this.requestBody(request)),
        signal,
      }),
      parseResponse: (response) => Promise.resolve(response),
      buildStatusError: (status, detail) => new NonRetryableHttpStatusError(status, `Anthropic request failed (${status}): ${detail}`),
      finalErrorMessage: 'Anthropic request failed after retries',
    });
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
    const anthropicTools = toAnthropicTools(request.tools);
    const thinkingBudget = getAnthropicThinkingBudget(this.config);
    const cacheableSystemPrompt =
      typeof request.cacheableSystemPrompt === 'string' && request.cacheableSystemPrompt.trim()
        ? request.cacheableSystemPrompt
        : request.systemPrompt;
    const dynamicSystemPrompt =
      typeof request.dynamicSystemPrompt === 'string' && request.dynamicSystemPrompt.trim()
        ? request.dynamicSystemPrompt
        : undefined;
    const promptCachingEnabled = supportsPromptCaching(this.config);
    const system = promptCachingEnabled
      ? [
          { type: 'text' as const, text: cacheableSystemPrompt, cache_control: EPHEMERAL_CACHE_CONTROL },
          ...(dynamicSystemPrompt ? [{ type: 'text' as const, text: dynamicSystemPrompt }] : []),
        ]
      : [{ type: 'text' as const, text: request.systemPrompt }];

    return {
      model: this.config.model,
      max_tokens: this.config.maxOutputTokens ?? 16000,
      // Note: temperature is normalized by providerQuirks.normalizeGenerationParamsForModel()
      // which sets temperature=1 when thinking is enabled (Anthropic requirement)
      temperature: this.config.temperature ?? 0,
      system,
      messages: toAnthropicMessages(request, { cacheLastMessage: promptCachingEnabled }),
      stream: true,
      ...(anthropicTools ? { tools: anthropicTools, tool_choice: { type: 'auto' } } : {}),
      thinking: thinkingBudget !== undefined
        ? { type: 'enabled', budget_tokens: thinkingBudget }
        : undefined,
    };
  }
}
