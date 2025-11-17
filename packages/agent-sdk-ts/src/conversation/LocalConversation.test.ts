import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { LocalConversation } from './LocalConversation';
import type { Event, MessageEvent } from '../types';
import { isActionEvent, isMessageEvent, isObservationEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';

class FakeLLM implements LLMClient {
  private readonly responses: LLMStreamChunk[][];

  constructor(responses: LLMStreamChunk[][]) {
    this.responses = responses;
  }

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const next = this.responses.shift() ?? [];
    for (const chunk of next) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 5 },
  confirmation: {},
  secrets: {},
};

describe('LocalConversation', () => {
  it('emits assistant messages when LLM responds without tools', async () => {
    const llm = new FakeLLM([[{ type: 'text', text: 'Hello world' }, { type: 'finish' }]]);
    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm });

    const events: Event[] = [];
    conversation.on('event', (e) => events.push(e));

    await conversation.sendUserMessage('hi');

    const assistantMessage = events.find(
      (e): e is MessageEvent => isMessageEvent(e) && e.source === 'agent',
    );
    expect(assistantMessage?.llm_message.content[0]).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('executes tool calls and emits observations', async () => {
    const llm = new FakeLLM([
      [
        { type: 'text', text: 'Working' },
        { type: 'tool_call_delta', id: 'tool_1', name: 'task_tracker', arguments: '{"action":"list"}' },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Tasks listed' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm });
    const events: Event[] = [];
    conversation.on('event', (e) => events.push(e));

    await conversation.sendUserMessage('list tasks');

    const actionEvent = events.find((e) => isActionEvent(e) && e.tool_name === 'task_tracker');
    expect(actionEvent).toBeDefined();

    const observationEvent = events.find((e) => isObservationEvent(e) && e.tool_name === 'task_tracker');
    expect(observationEvent).toBeDefined();

    const finalAssistant = events
      .filter((e): e is MessageEvent => isMessageEvent(e) && e.source === 'agent')
      .pop();
    expect(finalAssistant?.llm_message.content[0]).toEqual({ type: 'text', text: 'Tasks listed' });
  });
});
