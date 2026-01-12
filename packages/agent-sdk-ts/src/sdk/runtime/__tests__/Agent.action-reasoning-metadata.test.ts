import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isActionEvent } from '../../types';
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

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-action-reasoning-metadata-'));
const cleanupWorkspaceRoot = (workspaceRoot: string) => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
};

describe('Agent ActionEvent reasoning metadata', () => {
  it('includes thinking_blocks and redacts responses_reasoning_item.encrypted_content', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new QueueLLM([
      [
        { type: 'text', text: 'Call tools' },
        {
          type: 'responses_reasoning_item',
          item: { id: 'rs_1', summary: ['short summary'], encrypted_content: 'encrypted' },
        },
        { type: 'reasoning', reasoning: 'Thinking...' },
        { type: 'thinking_signature', signature: 'sig_1' },
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

      const actions = log.list().filter(isActionEvent);
      expect(actions.length).toBeGreaterThan(0);
      const action = actions.find((evt) => evt.tool_call_id === 'call_echo');
      expect(action).toBeDefined();

      expect(action?.thinking_blocks).toEqual([{ type: 'thinking', thinking: 'Thinking...', signature: 'sig_1' }]);

      expect(action?.responses_reasoning_item).toMatchObject({ id: 'rs_1', summary: ['short summary'] });
      expect(action?.responses_reasoning_item?.encrypted_content).toBeUndefined();
    } finally {
      cleanupWorkspaceRoot(workspaceRoot);
    }
  });
});

