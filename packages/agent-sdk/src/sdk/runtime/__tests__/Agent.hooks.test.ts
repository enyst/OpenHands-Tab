import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';
import { isMessageEvent, isObservationEvent } from '../../types';
import type { AgentHook } from '../hooks';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

class CountingLLM implements LLMClient {
  calls = 0;

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    this.calls += 1;
    yield { type: 'text', text: 'Hello' };
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hooks-'));

describe('Agent hooks', () => {
  it('runs hooks around tool execution (beforeToolCall can rewrite args; afterEvent ordering; afterToolCall receives observation)', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => {
        const value = (input as { value?: unknown }).value;
        if (typeof value !== 'string') throw new Error('value must be a string');
        return { value };
      },
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"original"}' },
      { type: 'finish' },
    ]);

    const timeline: string[] = [];
    let afterToolCallError: unknown;
    let afterToolCallArgs: Record<string, unknown> | undefined;
    let afterToolCallObservation: Record<string, unknown> | undefined;

    const hook: AgentHook = {
      beforeToolCall: ({ args }) => {
        timeline.push('beforeToolCall');
        return { args: { ...args, value: 'modified' } };
      },
      afterEvent: ({ event }) => {
        if (isObservationEvent(event) && event.tool_call_id === 'call_1') {
          timeline.push('afterEvent:ObservationEvent');
        }
        if (isMessageEvent(event) && event.llm_message.role === 'tool' && event.llm_message.tool_call_id === 'call_1') {
          timeline.push('afterEvent:ToolMessage');
        }
      },
      afterToolCall: ({ toolCall, args, observationEvent, error }) => {
        if (toolCall.id !== 'call_1') return;
        timeline.push('afterToolCall');
        afterToolCallError = error;
        afterToolCallArgs = args;
        afterToolCallObservation = observationEvent?.observation as Record<string, unknown> | undefined;
      },
    };

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
      hooks: hook,
    });

    await agent.run('run tool');

    expect(afterToolCallError).toBeUndefined();
    expect(afterToolCallArgs).toEqual({ value: 'modified' });
    expect(afterToolCallObservation).toEqual({ echoed: 'modified' });

    const afterEventObservationIdx = timeline.indexOf('afterEvent:ObservationEvent');
    const afterEventToolMessageIdx = timeline.indexOf('afterEvent:ToolMessage');
    const afterToolCallIdx = timeline.indexOf('afterToolCall');
    expect(afterEventObservationIdx).toBeGreaterThanOrEqual(0);
    expect(afterEventToolMessageIdx).toBeGreaterThan(afterEventObservationIdx);
    expect(afterToolCallIdx).toBeGreaterThan(afterEventToolMessageIdx);
  });

  it('shouldStop hook can stop the run loop before any LLM call', async () => {
    const log = new EventLog();
    const llm = new CountingLLM();

    const agent = new Agent({
      settings: { ...baseSettings, conversation: { maxIterations: 3 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      hooks: {
        shouldStop: () => true,
      },
    });

    await agent.run('hi');

    expect(llm.calls).toBe(0);
  });

  it('afterToolCall hook receives error when tool execution fails', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, never>, Record<string, never>> = {
      name: 'fail',
      validate: () => ({}),
      execute: async () => {
        throw new Error('boom');
      },
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'fail', arguments: '{}' },
      { type: 'finish' },
    ]);

    let called = false;
    let errorValue: unknown;

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
      hooks: {
        afterToolCall: ({ toolCall, observationEvent, error }) => {
          if (toolCall.id !== 'call_1') return;
          called = true;
          errorValue = error;
          expect(observationEvent).toBeUndefined();
        },
      },
    });

    await agent.run('run tool');

    expect(called).toBe(true);
    expect(errorValue).toBeTruthy();
  });
});

