import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { ToolDefinition } from '../../types/tools';
import { isMessageEvent, isObservationEvent } from '../../types';
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

const LONG = 'x'.repeat(2500);
const LONG_STDOUT = 'o'.repeat(50_000);

describe('Agent truncates tool logs and observations', () => {
  it('truncates llm_tool_call_raw arguments value', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ foo: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => input as { foo: string },
      execute: async (args) => ({ echoed: args.foo }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'c1', name: 'echo', arguments: JSON.stringify({ foo: LONG }) },
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
    expect(argStr.length).toBeLessThanOrEqual(2015); // 2000 + ellipsis
    expect(argStr.endsWith('…(truncated)')).toBe(true);
  });

  it('deep truncates ObservationEvent payload and tool message content', async () => {
    const log = new EventLog();
    const veryLong = 'x'.repeat(35_000);
    const tool: ToolDefinition<{ foo: string }, { deep: { s: string }, arr: string[] }> = {
      name: 'makeLong',
      validate: (input) => input as { foo: string },
      execute: async () => ({ deep: { s: veryLong }, arr: [veryLong, 'ok'] }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'c2', name: 'makeLong', arguments: JSON.stringify({ foo: 'ok' }) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [tool] });
    await agent.run('go');

    const events = log.list();
    const obs = events.find(isObservationEvent)!;
    expect(obs).toBeTruthy();
    // @ts-expect-error index
    const s = (obs.observation as any).deep.s as string;
    expect(s.length).toBeLessThanOrEqual(2015);
    expect(s.endsWith('…(truncated)')).toBe(true);

    const toolMsg = events.filter(isMessageEvent).find((m) => m.llm_message.role === 'tool');
    expect(toolMsg).toBeTruthy();
    const txt = toolMsg!.llm_message.content.find((c) => c.type === 'text') as { type: 'text'; text: string };
    expect(txt.text).toContain('<response clipped>');
    expect(txt.text.length).toBeLessThanOrEqual(8_000);
  });

  it('truncates large stdout results in ObservationEvent and tool message', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ command: string }, { stdout: string; exit_code: number }> = {
      name: 'terminal',
      validate: (input) => input as { command: string },
      execute: async () => ({ stdout: LONG_STDOUT, exit_code: 0 }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'c3', name: 'terminal', arguments: JSON.stringify({ command: 'echo' }) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [tool] });
    await agent.run('go');

    const events = log.list();
    const obs = events.find((event) => isObservationEvent(event) && event.tool_name === 'terminal');
    expect(obs).toBeTruthy();
    const stdout = (obs!.observation as any).stdout as string;
    expect(stdout.length).toBeLessThanOrEqual(2015);
    expect(stdout.endsWith('…(truncated)')).toBe(true);

    const toolMsg = events.filter(isMessageEvent).find((m) => m.llm_message.tool_call_id === 'c3');
    expect(toolMsg).toBeTruthy();
    const txt = toolMsg!.llm_message.content.find((c) => c.type === 'text') as { type: 'text'; text: string };
    expect(txt.text).toContain('<response clipped>');
    expect(txt.text.length).toBeLessThanOrEqual(8_000);
  });
});
