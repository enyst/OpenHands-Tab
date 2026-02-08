import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { OpenHandsSettings } from '../../types/settings';
import type { ToolDefinition } from '../../types/tools';
import { isObservationEvent } from '../../types';

class ToolCallLLM implements LLMClient {
  private callIndex = 0;

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void request;
    if (this.callIndex++ === 0) {
      yield { type: 'text', text: 'Editing file' };
      yield {
        type: 'tool_call_delta',
        id: 'call_file_editor',
        name: 'file_editor',
        arguments: '{"command":"str_replace","path":"README.md","old_str":"old","new_str":"new"}',
      };
      yield { type: 'finish' };
      return;
    }

    yield { type: 'text', text: 'Done' };
    yield { type: 'finish' };
  }
}

class SummaryLLM implements LLMClient {
  constructor(private readonly summary: string) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void request;
    yield { type: 'text', text: this.summary };
    yield { type: 'finish' };
  }
}

const workspaceRoots: string[] = [];
const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-file-diff-summary-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent file diff summaries (optional)', () => {
  it('attaches a summary to file_editor edit observations when enabled', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: true },
      conversation: { maxIterations: 3 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const llm = new ToolCallLLM();
    const summarizer = new SummaryLLM('Replaced old with new.');

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'file_editor',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'str_replace',
        path: 'README.md',
        prev_exist: true,
        old_content: 'old',
        new_content: 'new',
      }),
    };

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      toolSummarizerClient: summarizer,
      tools: [tool],
    });

    await agent.run('hi');

    const observation = log
      .list()
      .find((event) => isObservationEvent(event) && event.tool_name === 'file_editor');

    expect(observation).toBeTruthy();
    expect((observation as any).observation.summary).toBe('Replaced old with new.');
  });
});
