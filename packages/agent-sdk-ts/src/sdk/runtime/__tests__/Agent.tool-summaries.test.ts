import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { OpenHandsSettings } from '../../types/settings';
import type { ToolDefinition } from '../../types/tools';
import type { Event, ObservationEvent } from '../../types';

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

describe('Agent tool-call summaries', () => {
  it('attaches summary to observation event for UI display but does NOT send to LLM', async () => {
    // Gemini summaries should be saved in events for UI display, but NOT sent to the LLM.
    // Messages with role="assistant" must only come from the LLM, not be invented.
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: { summarizeToolCalls: true },
      conversation: { maxIterations: 3 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const llm = new RecordingLLM();
    const summarizer = new SummaryLLM('Tool executed successfully with value 1.');

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

    // Verify summary is attached to observation event for UI display
    const events = log.list();
    const observationEvent = events.find((e: Event) => e.kind === 'ObservationEvent') as ObservationEvent | undefined;
    expect(observationEvent).toBeDefined();
    expect(observationEvent!.observation.summary).toBe('Tool executed successfully with value 1.');

    // Verify that NO synthetic assistant messages with tool summaries are injected into LLM requests
    expect(llm.requests).toHaveLength(2);
    for (const request of llm.requests) {
      for (const message of request.messages) {
        if (message.role === 'assistant') {
          const text = message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
          // Synthetic tool summary messages should NOT be present
          expect(text).not.toContain('Tool summary');
          expect(text).not.toContain('Tool executed successfully');
        }
      }
    }

    // The last message in the second request should be a tool message, not an assistant message
    const secondRequest = llm.requests[1];
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    expect(lastMessage.role).toBe('tool');

    // Verify the tool message content does NOT contain the summary
    const toolMessageText = lastMessage.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    expect(toolMessageText).not.toContain('Tool executed successfully with value 1.');
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

    // Verify no summary is attached when disabled
    const events = log.list();
    const observationEvent = events.find((e: Event) => e.kind === 'ObservationEvent') as ObservationEvent | undefined;
    expect(observationEvent).toBeDefined();
    expect(observationEvent!.observation.summary).toBeUndefined();

    // Verify summarizer was not called
    expect(summarizer.requests).toHaveLength(0);

    expect(llm.requests).toHaveLength(2);
    const secondRequest = llm.requests[1];
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    // Last message should be a tool message, not an assistant message with summaries
    expect(lastMessage.role).toBe('tool');
  });
});

