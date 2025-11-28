import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}
  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

describe('Agent redacts sensitive tool-call arguments in llm_tool_call_raw', () => {
  it('masks common secret keys and bearer tokens, preserving truncation', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ any: string }, { ok: boolean }> = {
      name: 'noop',
      validate: (input) => (input as unknown) as { any: string },
      execute: async () => ({ ok: true }),
    };

    const args = {
      apiKey: 'SHOULD_NOT_LEAK',
      password: 'P@ssw0rd',
      nested: { token: 'tok-secret', client_secret: 'csecret' },
      headers: { Authorization: 'Bearer REALLY_LONG_TOKEN' },
      arr: [ { secret_key: 'array-secret' }, 'plain' ],
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'c1', name: 'noop', arguments: JSON.stringify(args) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [tool] });
    await agent.run('go');

    const updates = log
      .list()
      .filter((e) => e.kind === 'ConversationStateUpdateEvent' && (e as any).key === 'llm_tool_call_raw');

    expect(updates.length).toBeGreaterThan(0);
    const value = (updates[0] as any).value;
    expect(typeof value?.arguments).toBe('string');
    const argStr: string = value.arguments;

    // Should still be truncated if necessary and end with ellipsis when over limit
    expect(argStr.length).toBeLessThanOrEqual(2015);

    const parsed = JSON.parse(argStr);
    expect(parsed.apiKey).toBe('***');
    expect(parsed.password).toBe('***');
    expect(parsed.nested.token).toBe('***');
    expect(parsed.nested.client_secret).toBe('***');
    expect(parsed.arr[0].secret_key).toBe('***');
    // Authorization header value should be masked
    expect(parsed.headers.Authorization).toContain('Bearer ***');
  });

  it('masks nested secrets and token-like strings without requiring key names', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ any: string }, { ok: boolean }> = {
      name: 'noop',
      validate: (input) => (input as unknown) as { any: string },
      execute: async () => ({ ok: true }),
    };

    const args = {
      note: 'Encountered sk-abc123SECRETvalue while testing',
      nested: {
        description: 'bearer TOKENVALUE and ghp_abcdefghijklmnopqrstu',
        list: ['pat_token_value_123456', 'safe'],
      },
      headers: 'Authorization: Bearer AnotherToken',
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'c1', name: 'noop', arguments: JSON.stringify(args) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [tool] });
    await agent.run('go');

    const updates = log
      .list()
      .filter((e) => e.kind === 'ConversationStateUpdateEvent' && (e as any).key === 'llm_tool_call_raw');

    expect(updates.length).toBeGreaterThan(0);
    const parsed = JSON.parse((updates[0] as any).value.arguments as string);

    expect(parsed.note).toBe('Encountered *** while testing');
    expect(parsed.nested.description).toBe('bearer *** and ***');
    expect(parsed.nested.list[0]).toBe('***');
    expect(parsed.nested.list[1]).toBe('safe');
    expect(parsed.headers).toBe('Authorization: Bearer ***');
  });
});
