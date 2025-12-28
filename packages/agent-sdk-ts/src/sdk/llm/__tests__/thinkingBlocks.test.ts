import { describe, expect, it, vi, afterEach } from 'vitest';
import { LLMStreamer } from '../../runtime';
import { OpenAICompatibleClient, AnthropicClient } from '../index';
import type { ChatCompletionRequest, LLMConfiguration } from '../types';

const encoder = new TextEncoder();

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAICompatibleClient thinking blocks', () => {
  // Config with extended thinking enabled (required for thinking blocks)
  const baseConfig: LLMConfiguration = {
    model: 'claude-opus-4-5-20251101',
    provider: 'litellm_proxy',
    baseUrl: 'http://localhost:4000',
    reasoningEffort: 'medium',
  };

  it('includes thinking blocks in assistant messages with tool calls (LiteLLM format)', async () => {
    // For LiteLLM proxy: thinking blocks go in content array, but tool_calls stay in OpenAI format
    // LiteLLM will convert tool_calls to tool_use blocks when sending to Anthropic
    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Done"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const request: ChatCompletionRequest = {
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will use a tool' }],
          reasoning_content: 'This is my thinking process',
          thinking_signature: 'sig_abc123',
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
    };

    await streamer.runChat(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    // Find the assistant message
    const assistantMsg = body?.messages?.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Should have content as array with thinking block first
    expect(Array.isArray(assistantMsg.content)).toBe(true);

    const thinkingBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'thinking');
    expect(thinkingBlock).toEqual({
      type: 'thinking',
      thinking: 'This is my thinking process',
      signature: 'sig_abc123',
    });

    const textBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: 'I will use a tool' });

    // For LiteLLM: tool_calls should be in OpenAI format (separate field), NOT as tool_use in content
    // LiteLLM will convert these to tool_use blocks when proxying to Anthropic
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0]).toMatchObject({
      id: 'call_1',
      type: 'function',
      function: { name: 'bash', arguments: '{"command":"echo hi"}' },
    });

    // Should NOT have tool_use blocks in content (that's Anthropic native format, not LiteLLM)
    const toolUseBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'tool_use');
    expect(toolUseBlock).toBeUndefined();
  });

  it('does not include thinking blocks for assistant messages without tool calls', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Done"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const request: ChatCompletionRequest = {
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello there!' }],
          reasoning_content: 'This is my thinking process',
        },
      ],
    };

    await streamer.runChat(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    // Find the assistant message
    const assistantMsg = body?.messages?.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Should have string content (no thinking block needed when no tool_calls)
    expect(typeof assistantMsg.content).toBe('string');
    expect(assistantMsg.content).toBe('Hello there!');
  });

  it('does not include thinking blocks for non-Anthropic models', async () => {
    // Use a non-Anthropic model (GPT-4)
    const gptConfig: LLMConfiguration = { model: 'gpt-4o', provider: 'openai' };

    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Done"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new OpenAICompatibleClient(gptConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const request: ChatCompletionRequest = {
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will use a tool' }],
          reasoning_content: 'This is my thinking process',
          thinking_signature: 'sig_abc123',
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
    };

    await streamer.runChat(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    // Find the assistant message
    const assistantMsg = body?.messages?.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // For non-Anthropic models, should NOT include thinking blocks even with tool_calls
    // Content should be string, tool_calls in separate field
    expect(typeof assistantMsg.content).toBe('string');
    expect(assistantMsg.content).toBe('I will use a tool');
    expect(assistantMsg.tool_calls).toBeDefined();
  });

  it('streams thinking content and signature', async () => {
    // LiteLLM streams reasoning_content during generation, then sends thinking_blocks
    // with the signature in a final chunk. We should NOT extract thinking content from
    // thinking_blocks (that would double it), only the signature.
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}',
      'data: {"choices":[{"delta":{"thinking_blocks":[{"type":"thinking","signature":"sig_xyz"}]}}]}',
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const response = await streamer.runChat({
      systemPrompt: 'you are a test harness',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(response.message.reasoning_content).toBe('Thinking...');
    expect(response.message.thinking_signature).toBe('sig_xyz');
  });
});

describe('AnthropicClient thinking blocks', () => {
  const baseConfig: LLMConfiguration = { model: 'claude-opus-4-5-20251101', provider: 'anthropic' };

  it('includes thinking blocks in assistant messages with tool calls', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}',
      '',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const request: ChatCompletionRequest = {
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will use a tool' }],
          reasoning_content: 'This is my thinking process',
          thinking_signature: 'sig_abc123',
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
    };

    await streamer.runChat(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    // Find the assistant message
    const assistantMsg = body?.messages?.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    // Should have content as array with thinking block first
    expect(Array.isArray(assistantMsg.content)).toBe(true);

    const thinkingBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'thinking');
    expect(thinkingBlock).toEqual({
      type: 'thinking',
      thinking: 'This is my thinking process',
      signature: 'sig_abc123',
    });

    const textBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'text');
    expect(textBlock).toEqual({ type: 'text', text: 'I will use a tool' });

    const toolUseBlock = assistantMsg.content.find((b: { type: string }) => b.type === 'tool_use');
    expect(toolUseBlock).toMatchObject({
      type: 'tool_use',
      id: 'call_1',
      name: 'bash',
      input: { command: 'echo hi' },
    });
  });

  it('converts tool messages to user messages with tool_result content', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const request: ChatCompletionRequest = {
      systemPrompt: 'you are a test harness',
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
    };

    await streamer.runChat(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    // Tool result should be in a user message
    const toolResultMsg = body?.messages?.find((m: { role: string; content: { type: string }[] }) =>
      m.role === 'user' && m.content?.some?.((c: { type: string }) => c.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();

    const toolResultBlock = toolResultMsg.content.find((b: { type: string }) => b.type === 'tool_result');
    expect(toolResultBlock).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'hi',
    });
  });

  it('streams thinking content and signature', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Thinking about this..."}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_xyz"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello!"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\n');

    vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const response = await streamer.runChat({
      systemPrompt: 'you are a test harness',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(response.message.reasoning_content).toBe('Thinking about this...');
    expect(response.message.thinking_signature).toBe('sig_xyz');
    expect(response.message.content[0]).toEqual({ type: 'text', text: 'Hello!' });
  });

  it('streams tool calls from Anthropic format', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"bash"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"echo hi\\"}"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      '',
    ].join('\n');

    vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    const response = await streamer.runChat({
      systemPrompt: 'you are a test harness',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'run echo hi' }] }],
      tools: [{ type: 'function', function: { name: 'bash' } }],
    });

    expect(response.message.tool_calls).toHaveLength(1);
    expect(response.message.tool_calls?.[0]).toMatchObject({
      id: 'toolu_1',
      type: 'function',
      function: {
        name: 'bash',
        arguments: '{"command":"echo hi"}',
      },
    });
  });

  it('includes tools in request body', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":5}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      '',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));

    const client = new AnthropicClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await streamer.runChat({
      systemPrompt: 'you are a test harness',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Run a bash command',
            parameters: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;

    expect(body?.tools).toEqual([
      {
        name: 'bash',
        description: 'Run a bash command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ]);
    expect(body?.tool_choice).toEqual({ type: 'auto' });
  });
});
