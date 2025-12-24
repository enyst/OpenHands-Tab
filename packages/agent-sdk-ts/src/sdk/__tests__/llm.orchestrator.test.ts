import { describe, expect, it, vi, afterEach } from 'vitest';
import { AgentOrchestrator } from '../runtime';
import { DEFAULT_RETRY_OPTIONS, OpenAICompatibleClient, OpenAIResponsesClient, GeminiClient, LLMFactory, LLMCredentialProvider } from '../llm';
import type { ChatCompletionRequest, LLMConfiguration } from '../llm';
import { ConversationState, EventLog, SecretRegistry } from '../runtime';

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

  it('does not prepend previous llm_stream content on subsequent chats', async () => {
    const first = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hello"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');
    const second = [
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Bye"}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(createStreamResponse(first))
      .mockResolvedValueOnce(createStreamResponse(second));

    const state = new ConversationState({ eventLog: new EventLog() });
    const client = new OpenAICompatibleClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client, { state });

    const response1 = await orchestrator.runChat(buildRequest());
    expect(response1.message.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(state.snapshot.values.llm_stream).toBe('Hello');

    const response2 = await orchestrator.runChat(buildRequest());
    expect(response2.message.content[0]).toEqual({ type: 'text', text: 'Bye' });
    expect(state.snapshot.values.llm_stream).toBe('Bye');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on server errors', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hi"}]},"finish_reason":"stop"}]}' + '\n' + 'data: [DONE]';
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(createStreamResponse('failed', 500))
      .mockResolvedValueOnce(createStreamResponse(stream));

    const client = new OpenAICompatibleClient(
      { ...baseConfig, timeoutSeconds: 1 },
      'retry-key',
      { ...DEFAULT_RETRY_OPTIONS, baseDelayMs: 0, maxDelayMs: 0 },
    );
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

describe('GeminiClient streaming', () => {
  const baseConfig: LLMConfiguration = { model: 'gemini-2.5-flash', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };

  const buildRequest = (): ChatCompletionRequest => ({
    systemPrompt: 'you are a test harness',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ type: 'function', function: { name: 'ping' } }],
  });

  it('streams text, tool calls, and updates state', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"ping","args":{"ok":true}}}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse(sse));
    const state = new ConversationState({ eventLog: new EventLog() });
    const client = new GeminiClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client, { state });

    const response = await orchestrator.runChat(buildRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.message.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(response.message.tool_calls?.[0].function.name).toBe('ping');
    expect(response.message.tool_calls?.[0].function.arguments).toContain('ok');
    expect(state.snapshot.values.llm_stream).toBe('Hello');
    expect(String(state.snapshot.values.llm_tool_call)).toContain('gemini_call_');
  });

  it('retries on server errors', async () => {
    const stream = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}',
      'data: [DONE]',
    ].join('\n');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(createStreamResponse('failed', 500))
      .mockResolvedValueOnce(createStreamResponse(stream));

    const client = new GeminiClient(
      { ...baseConfig, timeoutSeconds: 1 },
      'retry-key',
      { ...DEFAULT_RETRY_OPTIONS, baseDelayMs: 0, maxDelayMs: 0 },
    );
    const orchestrator = new AgentOrchestrator(client);
    const response = await orchestrator.runChat(buildRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.message.content[0].type).toBe('text');
  });

  it('propagates failure after retries', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(createStreamResponse('error', 500));
    const client = new GeminiClient(baseConfig, 'bad-key');
    const orchestrator = new AgentOrchestrator(client);

    await expect(orchestrator.runChat(buildRequest())).rejects.toThrow(/LLM request failed/);
  });
});

describe('OpenAIResponsesClient (non-stream)', () => {
  const baseConfig: LLMConfiguration = { model: 'gpt-5-mini', provider: 'openai' };

  const buildRequest = (): ChatCompletionRequest => ({
    systemPrompt: 'you are a test harness',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ type: 'function', function: { name: 'ping' } }],
  });

  it('parses output text, tool calls, and reasoning item', async () => {
    const payload = {
      output: [
        {
          type: 'reasoning',
          id: 'rs_1',
          summary: [{ type: 'summary_text', text: 'short summary' }],
          encrypted_content: 'encrypted',
          status: 'completed',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
        {
          type: 'function_call',
          id: 'fc_call_1',
          call_id: 'fc_call_1',
          name: 'ping',
          arguments: '{"ok":true}',
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    const response = await orchestrator.runChat(buildRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('/responses');

    expect(response.message.content[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(response.message.tool_calls?.[0]).toEqual({
      id: 'fc_call_1',
      type: 'function',
      function: { name: 'ping', arguments: '{"ok":true}' },
    });
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: undefined });
    expect(response.message.responses_reasoning_item).toMatchObject({ id: 'rs_1', summary: ['short summary'], encrypted_content: 'encrypted' });
  });

  it('requests reasoning.encrypted_content include for stateless Responses', async () => {
    const payload = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    await orchestrator.runChat({
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'previous answer' }],
          responses_reasoning_item: { id: 'rs_1', summary: ['short summary'] },
        },
        { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      ],
      tools: [{ type: 'function', function: { name: 'ping' } }],
    });

    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body?.store).toBe(false);
    expect(body?.include).toEqual(['reasoning.encrypted_content']);
  });

  it('only re-sends responses_reasoning_item when encrypted_content is present (store=false)', async () => {
    const payload = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    await orchestrator.runChat({
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'previous answer' }],
          responses_reasoning_item: { id: 'rs_1', summary: ['short summary'] },
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'previous answer 2' }],
          responses_reasoning_item: { id: 'rs_2', summary: ['short summary'], encrypted_content: 'encrypted' },
        },
        { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      ],
      tools: [{ type: 'function', function: { name: 'ping' } }],
    });

    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body?.store).toBe(false);
    expect(Array.isArray(body?.input)).toBe(true);
    expect(body?.input?.some((item: { type?: unknown; id?: unknown }) => item.type === 'reasoning' && item.id === 'rs_1')).toBe(false);
    expect(body?.input?.some((item: { type?: unknown; id?: unknown; encrypted_content?: unknown }) => (
      item.type === 'reasoning'
        && item.id === 'rs_2'
        && item.encrypted_content === 'encrypted'
    ))).toBe(true);
  });

  it('round-trips encrypted_content exactly (store=false)', async () => {
    const payload = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient(baseConfig, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    const encryptedContent = 'encrypted\n';
    await orchestrator.runChat({
      systemPrompt: 'you are a test harness',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'previous answer' }],
          responses_reasoning_item: { id: 'rs_1', summary: ['short summary'], encrypted_content: encryptedContent },
        },
        { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
      ],
      tools: [{ type: 'function', function: { name: 'ping' } }],
    });

    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const reasoningItem = Array.isArray(body?.input)
      ? body.input.find((item: { type?: unknown; id?: unknown }) => item.type === 'reasoning' && item.id === 'rs_1')
      : undefined;

    expect(reasoningItem?.encrypted_content).toBe(encryptedContent);
  });

  it('includes reasoning summary in Responses request body when configured', async () => {
    const payload = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient({ ...baseConfig, reasoningEffort: 'medium', reasoningSummary: 'detailed' }, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    await orchestrator.runChat(buildRequest());

    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body?.reasoning).toEqual({ effort: 'medium', summary: 'detailed' });
  });

  it('ignores reasoningSummary when reasoningEffort is none', async () => {
    const payload = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const client = new OpenAIResponsesClient({ ...baseConfig, reasoningEffort: 'none', reasoningSummary: 'detailed' }, 'test-key');
    const orchestrator = new AgentOrchestrator(client);

    await orchestrator.runChat(buildRequest());

    const init = fetchMock.mock.calls[0]?.[1] as { body?: unknown } | undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body).not.toHaveProperty('reasoning');
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

  it('uses provider default API key from SecretRegistry when apiKey is unset', async () => {
    const secrets = new SecretRegistry();
    secrets.register('OPENAI_API_KEY', 'sk-storage');
    const spy = vi.spyOn(secrets, 'get');

    const factory = new LLMFactory({ model: 'gpt-4o-mini', provider: 'openai' }, { secrets });
    const client = await factory.createClient();

    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    expect(spy).toHaveBeenCalledWith('OPENAI_API_KEY');
  });

  it('routes GPT-5 models through Responses API', async () => {
    const factory = new LLMFactory({ model: 'gpt-5-mini', provider: 'openai', apiKey: 'sk-inline' });
    const client = await factory.createClient();
    expect(client).toBeInstanceOf(OpenAIResponsesClient);
  });

  it('honors openaiApiMode=chat_completions for GPT-5 models', async () => {
    const factory = new LLMFactory({ model: 'gpt-5-mini', provider: 'openai', openaiApiMode: 'chat_completions', apiKey: 'sk-inline' });
    const client = await factory.createClient();
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it('honors openaiApiMode=responses even when baseUrl is custom', async () => {
    const factory = new LLMFactory({
      model: 'gpt-5-mini',
      provider: 'openai',
      baseUrl: 'http://localhost:4000',
      openaiApiMode: 'responses',
      apiKey: 'sk-inline',
    });
    const client = await factory.createClient();
    expect(client).toBeInstanceOf(OpenAIResponsesClient);
  });

  it('does not route GPT-5 models through Responses API when baseUrl is custom', async () => {
    const factory = new LLMFactory({ model: 'gpt-5-mini', provider: 'openai', baseUrl: 'http://localhost:4000', apiKey: 'sk-inline' });
    const client = await factory.createClient();
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
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
