import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isAgentErrorEvent, isMessageEvent, type TextContent } from '../../types';
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

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-errors-'));

describe('Agent tool call error handling', () => {
  it('emits tool messages when parsing tool arguments fails', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call_delta', id: 'call_bad_args', name: 'echo', arguments: 'false' },
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
    const errors = events.filter(isAgentErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool_call_id).toBe('call_bad_args');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_bad_args');
    expect(toolMessages[0].llm_message.name).toBe('echo');

    const textContent = toolMessages[0].llm_message.content[0] as TextContent;
    expect(JSON.parse(textContent.text)).toMatchObject({ error: expect.stringContaining('Invalid tool arguments') });
  });

  it('emits tool messages when an unknown tool is requested', async () => {
    const log = new EventLog();
    const llm = new MockLLM([
      { type: 'text', text: 'Call missing tool' },
      { type: 'tool_call_delta', id: 'call_missing', name: 'does_not_exist', arguments: '{}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
    });

    await agent.run('unknown tool');

    const events = log.list();
    const errors = events.filter(isAgentErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool_call_id).toBe('call_missing');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_missing');
    expect(toolMessages[0].llm_message.name).toBe('does_not_exist');

    expect(agent.state.snapshot.status).toBe('IDLE');
  });

  it('propagates validation failures while emitting tool messages', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: () => {
        throw new Error('validation exploded');
      },
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Validate tool' },
      { type: 'tool_call_delta', id: 'call_validation', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('validate');
    await expect(agent.approveAction()).rejects.toThrow('Tool validation failed: validation exploded');

    const events = log.list();
    const errors = events.filter(isAgentErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool_call_id).toBe('call_validation');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_validation');
    expect(toolMessages[0].llm_message.name).toBe('echo');
  });

  it('propagates execution failures while emitting tool messages', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async () => {
        throw new Error('execution exploded');
      },
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Execute tool' },
      { type: 'tool_call_delta', id: 'call_execution', name: 'echo', arguments: '{"value":"boom"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('execute');
    await expect(agent.approveAction()).rejects.toThrow('execution exploded');

    const events = log.list();
    const errors = events.filter(isAgentErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool_call_id).toBe('call_execution');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_execution');
    expect(toolMessages[0].llm_message.name).toBe('echo');
  });
});
