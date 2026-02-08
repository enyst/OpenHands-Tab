import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';
import { LocalWorkspace } from '../../../workspace/LocalWorkspace';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

const workspaceRoots: string[] = [];

const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-inject-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent workspace option', () => {
  it('passes the provided workspace instance to tools', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };

    const workspace = new LocalWorkspace(createWorkspaceRoot());

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async (_args, context) => {
        expect(context.workspace).toBe(workspace);
        return { exit_code: 0, stdout: '', stderr: '' };
      },
    };

    const llm = new MockLLM([
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: new EventLog(),
      workspace,
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run');
  });
});
