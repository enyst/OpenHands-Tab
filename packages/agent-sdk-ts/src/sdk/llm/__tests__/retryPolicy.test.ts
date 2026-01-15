import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMStreamer } from '../../runtime';
import { OpenAICompatibleClient, OpenAIResponsesClient } from '../index';
import type { ChatCompletionRequest, LLMConfiguration, RetryOptions } from '../types';

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

describe('LLM HTTP retry policies', () => {
  const request: ChatCompletionRequest = {
    systemPrompt: 'you are a test harness',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  };

  it('OpenAICompatibleClient does not retry on non-retryable HTTP statuses', async () => {
    const baseConfig: LLMConfiguration = { model: 'gpt-4o-mini', provider: 'openai', baseUrl: 'http://localhost:4000' };
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"code":"context_length_exceeded"}}', { status: 400 }));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await expect(streamer.runChat(request)).rejects.toThrow(/LLM request failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('OpenAIResponsesClient does not retry on non-retryable HTTP statuses', async () => {
    const baseConfig: LLMConfiguration = { model: 'gpt-4o-mini', provider: 'openai', baseUrl: 'http://localhost:4000' };
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":{"code":"context_length_exceeded"}}', { status: 400 }));

    const client = new OpenAIResponsesClient(baseConfig, 'test-key');
    const streamer = new LLMStreamer(client);

    await expect(streamer.runChat(request)).rejects.toThrow(/LLM request failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('OpenAICompatibleClient still retries on retryable statuses', async () => {
    const baseConfig: LLMConfiguration = { model: 'gpt-4o-mini', provider: 'openai', baseUrl: 'http://localhost:4000' };
    const retry: RetryOptions = { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0, retryOn: (status) => status === 503 };

    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"OK"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('overloaded', { status: 503 }))
      .mockResolvedValueOnce(createStreamResponse(sse));

    const client = new OpenAICompatibleClient(baseConfig, 'test-key', retry);
    const streamer = new LLMStreamer(client);

    const result = await streamer.runChat(request);
    expect(result.message.role).toBe('assistant');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

