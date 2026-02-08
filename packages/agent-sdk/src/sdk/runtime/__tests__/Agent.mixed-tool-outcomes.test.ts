import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isActionEvent, isAgentErrorEvent, isMessageEvent, isObservationEvent } from '../../types';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class QueueLLM implements LLMClient {
  callCount = 0;

  constructor(private readonly runs: LLMStreamChunk[][]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    this.callCount += 1;
    const chunks = this.runs[this.callCount - 1] ?? [{ type: 'finish' as const }];
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 2 },
  confirmation: {},
  secrets: {},
};

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mixed-tool-outcomes-'));
const cleanupWorkspaceRoot = (workspaceRoot: string) => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
};

describe('Agent mixed tool call outcomes', () => {
  it('executes later tool calls even if an earlier tool is missing', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new QueueLLM([
      [
        { type: 'text', text: 'Call tools' },
        { type: 'tool_call_delta', id: 'call_missing', name: 'does_not_exist', arguments: '{}' },
        { type: 'tool_call_delta', id: 'call_echo', name: 'echo', arguments: '{"value":"ok"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'finish' },
      ],
    ]);

    const workspaceRoot = createWorkspaceRoot();
    try {
      const agent = new Agent({
        settings: baseSettings,
        events: log,
        workspaceRoot,
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('hi');

      expect(llm.callCount).toBe(2);
      expect(agent.state.snapshot.status).toBe('IDLE');

      const events = log.list();
      const actions = events.filter(isActionEvent);
      expect(actions).toHaveLength(2);
      expect(actions.some((e) => e.tool_call_id === 'call_missing')).toBe(true);
      expect(actions.some((e) => e.tool_call_id === 'call_echo')).toBe(true);

      const errors = events.filter(isAgentErrorEvent);
      expect(errors.filter((e) => e.tool_call_id === 'call_missing')).toHaveLength(1);
      expect(errors.some((e) => e.tool_call_id === 'call_echo')).toBe(false);

      const observations = events.filter(isObservationEvent);
      expect(observations.some((e) => e.tool_call_id === 'call_missing')).toBe(false);
      expect(observations.filter((e) => e.tool_call_id === 'call_echo')).toHaveLength(1);

      const toolMessages = events
        .filter(isMessageEvent)
        .filter((evt) => evt.llm_message.role === 'tool')
        .map((evt) => evt.llm_message.tool_call_id);
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages).toContain('call_missing');
      expect(toolMessages).toContain('call_echo');
    } finally {
      cleanupWorkspaceRoot(workspaceRoot);
    }
  });

  it('executes later tool calls even if an earlier tool call has invalid JSON args', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new QueueLLM([
      [
        { type: 'text', text: 'Call tools' },
        // JSON primitive (not an object) -> parseToolArgs emits tool error, no ActionEvent is recorded.
        { type: 'tool_call_delta', id: 'call_bad_args', name: 'echo', arguments: 'false' },
        { type: 'tool_call_delta', id: 'call_echo', name: 'echo', arguments: '{"value":"ok"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'finish' },
      ],
    ]);

    const workspaceRoot = createWorkspaceRoot();
    try {
      const agent = new Agent({
        settings: baseSettings,
        events: log,
        workspaceRoot,
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('hi');

      expect(llm.callCount).toBe(2);
      expect(agent.state.snapshot.status).toBe('IDLE');

      const events = log.list();
      const actions = events.filter(isActionEvent);
      expect(actions).toHaveLength(1);
      expect(actions.some((e) => e.tool_call_id === 'call_bad_args')).toBe(false);
      expect(actions.some((e) => e.tool_call_id === 'call_echo')).toBe(true);

      const errors = events.filter(isAgentErrorEvent);
      expect(errors.filter((e) => e.tool_call_id === 'call_bad_args')).toHaveLength(1);
      expect(errors.some((e) => e.tool_call_id === 'call_echo')).toBe(false);

      const observations = events.filter(isObservationEvent);
      expect(observations.some((e) => e.tool_call_id === 'call_bad_args')).toBe(false);
      expect(observations.filter((e) => e.tool_call_id === 'call_echo')).toHaveLength(1);

      const toolMessages = events
        .filter(isMessageEvent)
        .filter((evt) => evt.llm_message.role === 'tool')
        .map((evt) => evt.llm_message.tool_call_id);
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages).toContain('call_bad_args');
      expect(toolMessages).toContain('call_echo');
    } finally {
      cleanupWorkspaceRoot(workspaceRoot);
    }
  });
});
