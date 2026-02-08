import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import type { OpenHandsSettings } from '../../types/settings';

class ThinkThenFinishLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);

    if (this.requests.length === 1) {
      yield { type: 'tool_call_delta', id: 'tool_think', name: 'think', arguments: '{"thought":"hello"}' };
      yield { type: 'finish' };
      return;
    }

    yield { type: 'text', text: 'done' };
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 2 },
  confirmation: { policy: 'never' },
  secrets: {},
};

describe('ThinkTool parity', () => {
  it('includes think observation output in the next LLM request context', async () => {
    const llm = new ThinkThenFinishLLM();
    const log = new EventLog();
    const agent = new Agent({ settings: baseSettings, events: log, llmClient: llm });

    await agent.run('hi');

    expect(llm.requests).toHaveLength(2);

    const second = llm.requests[1];
    const thinkToolMessage = second.messages.find((m) => m.role === 'tool' && m.name === 'think');
    expect(thinkToolMessage).toBeDefined();
    const toolText = thinkToolMessage?.content?.[0]?.type === 'text' ? thinkToolMessage.content[0].text : '';
    expect(toolText).toContain('Your thought has been logged.');
  });
});

