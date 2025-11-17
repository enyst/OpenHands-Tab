import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { LocalConversation } from '../conversation/LocalConversation';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import type { BashEvent, Event, OpenHandsSettings } from '../types';

class FakeLLM implements LLMClient {
  private callIndex = 0;

  constructor(private readonly responses: LLMStreamChunk[][]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const chunks = this.responses[this.callIndex] ?? [];
    this.callIndex += 1;
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'gpt-local-test', nativeToolCalling: true },
  agent: {},
  conversation: { maxIterations: 3 },
  confirmation: {},
  secrets: {},
  serverUrl: undefined,
};

describe('LocalConversation', () => {
  it('executes tools locally and emits observation events', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'local-conv-'));
    const llm = new FakeLLM([
      [
        { type: 'tool_call_delta', id: 'call_1', name: 'file_editor', arguments: '{"path":"note.txt","content":"hello"}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'Wrote the file' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, workspaceRoot: tmp, llmClient: llm });
    const events: Event[] = [];
    conversation.on('event', (event) => events.push(event));

    await conversation.sendUserMessage('write a file');

    const content = readFileSync(path.join(tmp, 'note.txt'), 'utf8');
    expect(content).toContain('hello');

    const observation = events.find((event) => event.type === 'ObservationEvent');
    expect(observation).toBeDefined();
    const assistantMessages = events.filter((event) => event.type === 'MessageEvent' && event.source === 'agent');
    expect(assistantMessages.length).toBeGreaterThan(0);
  });

  it('emits bash events when terminal tool runs', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'local-conv-term-'));
    const llm = new FakeLLM([
      [
        { type: 'tool_call_delta', id: 'call_2', name: 'terminal', arguments: '{"command":"pwd"}' },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'Ran command' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, workspaceRoot: tmp, llmClient: llm });
    const bashEvents: BashEvent[] = [];
    conversation.on('terminal', (event) => bashEvents.push(event));

    await conversation.sendUserMessage('run pwd');

    expect(bashEvents.some((event) => event.type === 'BashCommand')).toBe(true);
    expect(bashEvents.some((event) => event.type === 'BashExit')).toBe(true);
  });
});
