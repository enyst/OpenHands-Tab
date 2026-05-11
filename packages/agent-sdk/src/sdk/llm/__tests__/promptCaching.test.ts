import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMStreamer } from '../../runtime';
import { AnthropicClient, OpenAICompatibleClient } from '../index';
import type { ChatCompletionRequest, LLMConfiguration } from '../types';

const encoder = new TextEncoder();
const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' };

const createStreamResponse = (payload: string, status = 200): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );

const anthropicSse = [
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
  '',
].join('\n');

const openAiSse = [
  'data: {"choices":[{"delta":{"content":"Done"}}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
].join('\n');

const splitSystemPromptRequest = (
  overrides: Partial<ChatCompletionRequest> = {},
): ChatCompletionRequest => ({
  systemPrompt: 'STATIC\n\nDYNAMIC',
  cacheableSystemPrompt: 'STATIC',
  dynamicSystemPrompt: 'DYNAMIC',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Anthropic prompt caching', () => {
  const baseConfig: LLMConfiguration = {
    model: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
  };

  it('marks only the static system block and last user block for caching', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(createStreamResponse(anthropicSse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await streamer.runChat(splitSystemPromptRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    expect(body?.system).toEqual([
      { type: 'text', text: 'STATIC', cache_control: EPHEMERAL_CACHE_CONTROL },
      { type: 'text', text: 'DYNAMIC' },
    ]);
    expect(body?.messages?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello', cache_control: EPHEMERAL_CACHE_CONTROL }],
    });
  });

  it('moves the cache marker to the tool-result message level', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(createStreamResponse(anthropicSse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await streamer.runChat(splitSystemPromptRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [],
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"echo hi"}' },
            },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'hi' }],
          tool_call_id: 'call_1',
        },
      ],
      tools: [{ type: 'function', function: { name: 'bash' } }],
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    expect(body?.messages?.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'hi' }],
      cache_control: EPHEMERAL_CACHE_CONTROL,
    });
  });
});

describe('OpenAI-compatible Anthropic prompt caching', () => {
  const baseConfig: LLMConfiguration = {
    model: 'claude-sonnet-4-5-20250929',
    provider: 'litellm_proxy',
    baseUrl: 'http://localhost:4000',
  };

  it('marks only the static system block and last user block for caching', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(createStreamResponse(openAiSse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await streamer.runChat(splitSystemPromptRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    expect(body?.messages?.[0]).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'STATIC', cache_control: EPHEMERAL_CACHE_CONTROL },
        { type: 'text', text: 'DYNAMIC' },
      ],
    });
    expect(body?.messages?.[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello', cache_control: EPHEMERAL_CACHE_CONTROL }],
    });
  });

  it('moves the cache marker to the tool message level', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(createStreamResponse(openAiSse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await streamer.runChat(splitSystemPromptRequest({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"echo hi"}' },
            },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'hi' }],
          tool_call_id: 'call_1',
        },
      ],
      tools: [{ type: 'function', function: { name: 'bash' } }],
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    expect(body?.messages?.at(-1)).toEqual({
      role: 'tool',
      content: 'hi',
      tool_call_id: 'call_1',
      cache_control: EPHEMERAL_CACHE_CONTROL,
    });
  });
});
