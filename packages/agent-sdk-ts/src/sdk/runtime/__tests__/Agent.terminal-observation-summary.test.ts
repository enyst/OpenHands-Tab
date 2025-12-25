import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isObservationEvent, type ObservationEvent } from '../../types';
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-summary-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent terminal ObservationEvent summaries (UI)', () => {
  it('attaches observation.summary when tool summaries are enabled', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: true },
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const summarizer = new SummaryLLM('Listed the repository status.');

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'git status',
        exit_code: 0,
        stdout: 'On branch develop\nnothing to commit, working tree clean\n',
        stderr: '',
        timeout: false,
      }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Running terminal' },
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"git status"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      toolSummarizerClient: summarizer,
      tools: [tool],
    });

    await agent.run('run terminal');

    expect(summarizer.requests.some((req) => req.systemPrompt === 'You summarize terminal tool results for an IDE UI.')).toBe(true);

    const observationEvent = log.list().find((event) => isObservationEvent(event) && event.tool_name === 'terminal');
    expect(observationEvent).toBeTruthy();
    const observation = (observationEvent as ObservationEvent).observation as Record<string, unknown>;
    expect(observation.summary).toBe('Listed the repository status.');
  });

  it('does not attach observation.summary when disabled', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: false },
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const summarizer = new SummaryLLM('should not be used');

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'git status',
        exit_code: 0,
        stdout: 'clean\n',
        stderr: '',
        timeout: false,
      }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Running terminal' },
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"git status"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      toolSummarizerClient: summarizer,
      tools: [tool],
    });

    await agent.run('run terminal');

    expect(summarizer.requests).toHaveLength(0);

    const observationEvent = log.list().find((event) => isObservationEvent(event) && event.tool_name === 'terminal');
    expect(observationEvent).toBeTruthy();
    const observation = (observationEvent as ObservationEvent).observation as Record<string, unknown>;
    expect(observation.summary).toBeUndefined();
  });
});
