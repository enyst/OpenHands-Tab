import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class MultiCallMockLLM implements LLMClient {
  private callIndex = 0;

  constructor(private readonly calls: LLMStreamChunk[][]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    const chunks = this.calls[this.callIndex] ?? [];
    this.callIndex += 1;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model', provider: 'openai', temperature: 0.25, maxOutputTokens: 64 },
  agent: { debug: true },
  conversation: { maxIterations: 2 },
  confirmation: {},
  secrets: {},
};

describe('Agent debug LLM payload events', () => {
  it('emits sanitized request/response payloads (no system prompt, redacted tool args, truncated tool text)', async () => {
    const log = new EventLog();

    const tool: ToolDefinition<{ any: string }, { ok: boolean; output: string }> = {
      name: 'noop',
      validate: (input) => (input as unknown) as { any: string },
      execute: async () => ({ ok: true, output: `TOOL_OUTPUT:${'x'.repeat(500)}` }),
    };

    const args = {
      apiKey: 'SHOULD_NOT_LEAK',
      note: 'x'.repeat(5000),
    };

    const llm = new MultiCallMockLLM([
      [
        { type: 'text', text: 'Using tool' },
        { type: 'tool_call_delta', id: 'c1', name: 'noop', arguments: JSON.stringify(args) },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'finish' },
      ],
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [tool] });
    await agent.run('go');

    const requestPayloads = log
      .list()
      .filter((e) => e.kind === 'ConversationStateUpdateEvent' && (e as any).key === 'llm_request_payload')
      .map((e) => (e as any).value);
    expect(requestPayloads.length).toBeGreaterThanOrEqual(2);

    const firstRequest = requestPayloads[0];
    expect(firstRequest.request.systemPrompt).toBe('SYSTEM_PROMPT');
    expect(Array.isArray(firstRequest.request.tools)).toBe(true);
    expect(firstRequest.request.tools).toContain('noop');
    expect(typeof firstRequest.request.tools[0]).toBe('string');
    expect(firstRequest.request.parameters).toEqual({ temperature: 0.25, maxOutputTokens: 64 });

    const secondRequest = requestPayloads[1];
    const toolMessage = (secondRequest.request.messages as any[]).find((m) => m?.role === 'tool');
    expect(toolMessage).toBeTruthy();
    const toolText = Array.isArray(toolMessage?.content)
      ? (toolMessage.content as any[]).find((c) => c?.type === 'text')?.text
      : '';
    expect(typeof toolText).toBe('string');
    expect(toolText).toContain('…');
    expect(toolText.length).toBe(201);

    const responsePayloads = log
      .list()
      .filter((e) => e.kind === 'ConversationStateUpdateEvent' && (e as any).key === 'llm_response_payload')
      .map((e) => (e as any).value);
    expect(responsePayloads.length).toBeGreaterThanOrEqual(1);

    const firstResponse = responsePayloads[0];
    const toolCalls = firstResponse.response.message.tool_calls;
    expect(Array.isArray(toolCalls)).toBe(true);
    expect(toolCalls.length).toBeGreaterThan(0);
    const argStr = toolCalls[0].function.arguments as string;
    expect(typeof argStr).toBe('string');
    expect(argStr).not.toContain('SHOULD_NOT_LEAK');
    expect(argStr).toContain('***');
    expect(argStr).toContain('…(truncated)');
    expect(argStr.length).toBeLessThanOrEqual(2015);
  });
});
