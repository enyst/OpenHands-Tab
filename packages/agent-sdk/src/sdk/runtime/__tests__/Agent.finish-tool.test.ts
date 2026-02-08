import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { Event } from '../../types';
import { isObservationEvent } from '../../types';
import type { OpenHandsSettings } from '../../types/settings';
import type { ToolDefinition } from '../../types/tools';

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
  conversation: { maxIterations: 2 },
  confirmation: { policy: 'always', confirmUnknown: true, riskyThreshold: 'MEDIUM' },
  secrets: {},
};

describe('FinishTool', () => {
  it('stops the run and skips subsequent tool calls in the same batch', async () => {
    const log = new EventLog();
    let executed = 0;

    const terminalTool: ToolDefinition<{ command: string }, { stdout: string }> = {
      name: 'terminal',
      validate: (input) => input as { command: string },
      execute: async () => {
        executed += 1;
        return { stdout: 'hi' };
      },
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tools' },
      { type: 'tool_call_delta', id: 'f1', name: 'finish', arguments: JSON.stringify({ message: 'done' }) },
      { type: 'tool_call_delta', id: 't1', name: 'terminal', arguments: JSON.stringify({ command: 'echo hi' }) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [terminalTool] });
    await agent.run('go');

    expect(executed).toBe(0);
    expect(agent.state.snapshot.status).toBe('IDLE');

    const events = log.list() as Event[];
    const terminalObs = events.find((evt) => isObservationEvent(evt) && evt.tool_name === 'terminal');
    expect(terminalObs).toBeTruthy();
    const observation = (terminalObs as any).observation as Record<string, unknown>;
    expect(observation.skipped).toBe(true);
  });

  it('never requires confirmation even when policy=always', async () => {
    const log = new EventLog();
    const llm = new MockLLM([
      { type: 'text', text: 'All done' },
      { type: 'tool_call_delta', id: 'f1', name: 'finish', arguments: JSON.stringify({ message: 'done' }) },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: '/tmp', llmClient: llm, tools: [] });
    await agent.run('go');

    expect(agent.state.snapshot.status).toBe('IDLE');
    expect(log.list().some((evt) => evt.kind === 'PauseEvent')).toBe(false);
  });
});

