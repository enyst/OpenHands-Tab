import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { OpenHandsSettings } from '../../types/settings';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'text', text: 'ok' };
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: { policy: 'never' },
  secrets: {},
};

describe('Agent builtin tools', () => {
  it('includes finish and think when includeDefaultTools is not false', async () => {
    const llm = new RecordingLLM();
    const log = new EventLog();
    const agent = new Agent({ settings: baseSettings, events: log, llmClient: llm });

    await agent.run('hi');

    const tools = llm.requests[0]?.tools ?? [];
    const names = tools.map((t) => t.function?.name).filter((v): v is string => typeof v === 'string');
    expect(names).toContain('finish');
    expect(names).toContain('think');
  });

  it('omits builtin tools when includeDefaultTools is false', async () => {
    const llm = new RecordingLLM();
    const log = new EventLog();
    const agent = new Agent({ settings: baseSettings, events: log, llmClient: llm, includeDefaultTools: false });

    await agent.run('hi');

    expect(llm.requests[0]?.tools ?? []).toHaveLength(0);
  });
});

