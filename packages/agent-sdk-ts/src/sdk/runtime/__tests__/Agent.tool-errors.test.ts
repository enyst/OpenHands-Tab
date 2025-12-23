import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isAgentErrorEvent, isConversationErrorEvent, isMessageEvent, type TextContent } from '../../types';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class MockLLM implements LLMClient {
  requests: ChatCompletionRequest[] = [];

  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
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

const workspaceRoots: string[] = [];

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-errors-'));
  workspaceRoots.push(root);
  return root;
};

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
    expect(errors[0].error).toContain('Error validating args');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_bad_args');
    expect(toolMessages[0].llm_message.name).toBe('echo');

    const textContent = toolMessages[0].llm_message.content[0] as TextContent;
    // Python SDK sends plain text, not JSON
    expect(textContent.text).toContain('Error validating args');
    expect(textContent.text).toContain('echo');
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
    expect(errors[0].error).toContain('not found');
    expect(errors[0].error).toContain('does_not_exist');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_missing');
    expect(toolMessages[0].llm_message.name).toBe('does_not_exist');

    const textContent = toolMessages[0].llm_message.content[0] as TextContent;
    // Python SDK sends plain text matching error message
    expect(textContent.text).toContain('not found');
    expect(textContent.text).toContain('does_not_exist');

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
    await expect(agent.approveAction()).rejects.toThrow('Error validating args');

    const events = log.list();
    const errors = events.filter(isAgentErrorEvent);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool_call_id).toBe('call_validation');
    expect(errors[0].error).toContain('Error validating args');
    expect(errors[0].error).toContain('validation exploded');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_validation');
    expect(toolMessages[0].llm_message.name).toBe('echo');

    const textContent = toolMessages[0].llm_message.content[0] as TextContent;
    // Python SDK sends plain text matching error message
    expect(textContent.text).toContain('Error validating args');
    expect(textContent.text).toContain('validation exploded');
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
    expect(errors[0].error).toContain('execution exploded');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].llm_message.tool_call_id).toBe('call_execution');
    expect(toolMessages[0].llm_message.name).toBe('echo');

    const textContent = toolMessages[0].llm_message.content[0] as TextContent;
    // Python SDK sends plain text matching error message
    expect(textContent.text).toContain('execution exploded');
  });

  it('emits ConversationErrorEvent (and no tool message) for conversation-level tool execution failures', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, unknown> = {
      name: 'browser',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => {
        throw new Error('Global fetch API is unavailable in this runtime');
      },
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Try browser' },
      { type: 'tool_call_delta', id: 'call_fetch_missing', name: 'browser', arguments: '{"url":"https://example.com"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('browse');

    const events = log.list();
    expect(events.filter(isAgentErrorEvent)).toHaveLength(0);

    const conversationError = events.find(isConversationErrorEvent);
    expect(conversationError).toBeDefined();
    expect(conversationError?.code).toBe('missing_fetch_api');

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages).toHaveLength(0);

    expect(agent.state.snapshot.status).toBe('IDLE');
  });

  it('sanitizes orphan tool_calls from future requests after conversation-level tool failures', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, unknown> = {
      name: 'browser',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => {
        throw new Error('Global fetch API is unavailable in this runtime');
      },
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Try browser' },
      { type: 'tool_call_delta', id: 'call_fetch_missing', name: 'browser', arguments: '{"url":"https://example.com"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, conversation: { maxIterations: 2 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('browse');
    await agent.run('retry after failure');

    expect(llm.requests).toHaveLength(2);
    const secondRequest = llm.requests[1];
    const hasOrphanedToolCalls = secondRequest.messages.some(
      (message) => message.role === 'assistant' && message.tool_calls?.some((call) => call.id === 'call_fetch_missing'),
    );
    expect(hasOrphanedToolCalls).toBe(false);
  });
});
