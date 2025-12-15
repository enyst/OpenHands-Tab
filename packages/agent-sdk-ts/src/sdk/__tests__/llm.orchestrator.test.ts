import { describe, expect, it, vi, afterEach } from 'vitest';
import { AgentOrchestrator } from '../runtime';
import { OpenAICompatibleClient, LLMFactory, LLMCredentialProvider } from '../llm';
import type { ChatCompletionRequest, LLMConfiguration } from '../llm';
import { ConversationState, EventLog } from '../runtime';

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

describe('OpenAICompatibleClient streaming', () => {
  const baseConfig: LLMConfiguration = { model: 'gpt-4o-mini', provider: 'openai' };

  const buildRequest = (): ChatCompletionRequest => ({
    systemPrompt: 'you are a test harness',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ type: 'function', function: { name: 'ping' } }],
  });

  it('streams text, tool calls, and updates state', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hello"}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"ping","arguments":"{\\"ok\\":tru"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"e}"}}]}},"usage":{"prompt_tokens":5,"completion_tokens":2}}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));
    const state = new ConversationState({ eventLog: new EventLog() });
    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client, { state });

    const response = await orchestrator.runChat(buildRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.message.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(response.message.tool_calls?.[0].function.arguments).toContain('ok');
    expect(state.snapshot.values.llm_stream).toBe('Hello');
    expect(state.snapshot.values.llm_tool_call).toBe('call_1');
  });

  it('retries on server errors', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hi"}]},"finish_reason":"stop"}]}' + '\n' + 'data: [DONE]';
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(createStreamResponse('failed', 500))
      .mockResolvedValueOnce(createStreamResponse(stream));

    const client = new OpenAICompatibleClient({ ...baseConfig, timeoutSeconds: 1 }, 'retry-key');
    const orchestrator = new AgentOrchestrator(client);
    const response = await orchestrator.runChat(buildRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.message.content[0].type).toBe('text');
  });

  it('propagates failure after retries', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse('error', 500));
    const client = new OpenAICompatibleClient(baseConfig, 'bad-key');
    const orchestrator = new AgentOrchestrator(client);

    await expect(orchestrator.runChat(buildRequest())).rejects.toThrow(/LLM request failed/);
  });
});

describe('LLMFactory integration', () => {
  it('uses inline apiKey without registry lookup', async () => {
    const spy = vi.spyOn(LLMCredentialProvider.prototype, 'getApiKey');
    const factory = new LLMFactory({ model: 'gpt-4o-mini', provider: 'openai', apiKey: 'sk-inline' });

    const client = await factory.createClient();

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    expect(spy).not.toHaveBeenCalled();
  });

  const maybeIt = process.env.OPENAI_API_KEY ? it : it.skip;

  maybeIt('streams from OpenAI with real credentials', async () => {
    const factory = new LLMFactory({ model: 'gpt-4o-mini', provider: 'openai', maxOutputTokens: 8 });
    const client = await factory.createClient();
    const orchestrator = new AgentOrchestrator(client);

    const result = await orchestrator.runChat({
      systemPrompt: 'You are a concise bot',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hello in one short sentence.' }] }],
    });

    expect(result.message.content[0].type).toBe('text');
    expect(result.message.content[0].text.length).toBeGreaterThan(0);
  });
});
