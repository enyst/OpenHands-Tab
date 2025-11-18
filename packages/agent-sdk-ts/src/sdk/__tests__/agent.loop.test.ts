import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { isActionEvent, isMessageEvent, isObservationEvent, isPauseEvent } from '../types';
import type { ToolHandler } from '../types/tools';
import type { OpenHandsSettings } from '../types/settings';

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

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));

describe('Agent loop control', () => {
  it('emits system prompt and stops when no tool calls', async () => {
    const log = new EventLog();
    const llm = new MockLLM([
      { type: 'text', text: 'Hello' },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: createWorkspaceRoot(), llmClient: llm });

    await agent.run('hi there');

    const events = log.list();
    expect(events.some((event) => (event as any).kind === 'SystemPromptEvent')).toBe(true);
    const messages = events.filter(isMessageEvent);
    expect(messages.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(agent.state.snapshot.iteration).toBe(1);
  });

  it('honors confirmation policy and executes tool on approval', async () => {
    const log = new EventLog();
    const tool: ToolHandler<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run tool');
    const eventsAfterRun = log.list();
    expect(eventsAfterRun.some(isActionEvent)).toBe(true);
    expect(eventsAfterRun.some(isPauseEvent)).toBe(true);
    expect(eventsAfterRun.some(isObservationEvent)).toBe(false);

    await agent.approveAction();
    const eventsAfterApproval = log.list();
    expect(eventsAfterApproval.some(isObservationEvent)).toBe(true);
    const toolMessages = eventsAfterApproval.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages.length).toBe(1);
  });

  it('records agent error when tool arguments are not objects', async () => {
    const log = new EventLog();
    const tool: ToolHandler<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call_delta', id: 'call_invalid', name: 'echo', arguments: 'false' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });
    await agent.run('bad args');

    const events = log.list();
    const agentErrors = events.filter((event) => (event as any).kind === 'AgentErrorEvent');
    expect(agentErrors).toHaveLength(1);
    expect((agentErrors[0] as { tool_call_id?: string }).tool_call_id).toBe('call_invalid');
    expect(events.some(isActionEvent)).toBe(false);
    expect(events.some(isObservationEvent)).toBe(false);
  });

  it('handles JSON primitives in tool arguments by emitting agent error', async () => {
    const log = new EventLog();
    const tool: ToolHandler<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call_delta', id: 'call_primitive', name: 'echo', arguments: '42' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });
    await agent.run('bad args');

    const events = log.list();
    const agentErrors = events.filter((event) => (event as any).kind === 'AgentErrorEvent');
    expect(agentErrors).toHaveLength(1);
    expect((agentErrors[0] as { tool_call_id?: string }).tool_call_id).toBe('call_primitive');
    expect(events.some(isActionEvent)).toBe(false);
    expect(events.some(isObservationEvent)).toBe(false);
  });
});
