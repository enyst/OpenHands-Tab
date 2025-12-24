import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { OpenHandsSettings } from '../../types/settings';
import type { ToolDefinition } from '../../types/tools';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];
  private callIndex = 0;

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);

    if (this.callIndex++ === 0) {
      yield { type: 'text', text: 'Running tool' };
      yield { type: 'tool_call_delta', id: 'call_example', name: 'example', arguments: '{"value":1}' };
      yield { type: 'finish' };
      return;
    }

    yield { type: 'text', text: 'Done' };
    yield { type: 'finish' };
  }
}

class SummaryLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly summary: string) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: this.summary };
    yield { type: 'finish' };
  }
}

const workspaceRoots: string[] = [];
const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-summaries-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent tool-call summaries (optional)', () => {
  it('injects a summary into the next LLM request when enabled', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: true },
      conversation: { maxIterations: 3 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const llm = new RecordingLLM();
    const summarizer = new SummaryLLM('Ran example tool successfully.');

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'example',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ ok: true, value: 1 }),
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

    expect(summarizer.requests).toHaveLength(1);
    expect(llm.requests).toHaveLength(2);

    const secondRequest = llm.requests[1];
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    expect(lastMessage.role).toBe('assistant');

    const lastText = lastMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(lastText).toContain('Ran example tool successfully.');
  });

  it('does not summarize tools when disabled', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: false },
      conversation: { maxIterations: 3 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const llm = new RecordingLLM();
    const summarizer = new SummaryLLM('should not be used');

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'example',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ ok: true }),
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

    expect(summarizer.requests).toHaveLength(0);
    expect(llm.requests).toHaveLength(2);
    const secondRequest = llm.requests[1];
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    const lastText = lastMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    expect(lastText).not.toContain('should not be used');
  });
});

