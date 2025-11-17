import { describe, expect, it } from 'vitest';
import { LocalConversation } from '../conversation/LocalConversation';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { isActionEvent, isMessageEvent, isObservationEvent, type Event } from '../types';
import type { OpenHandsSettings } from '../types/settings';

class FakeStreamingLLM implements LLMClient {
  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const last = request.messages[request.messages.length - 1];
    if (last.role === 'user') {
      yield { type: 'text', text: 'Planning…' };
      yield {
        type: 'tool_call_delta',
        id: 'call_1',
        name: 'task_tracker',
        arguments: '{"action":"create","title":"demo"}',
      };
      yield { type: 'finish' };
      return;
    }

    yield { type: 'text', text: 'Task created' };
    yield { type: 'finish' };
  }
}

describe('LocalConversation', () => {
  const settings: OpenHandsSettings = {
    llm: { model: 'fake-model' },
    agent: {},
    conversation: { maxIterations: 5 },
    confirmation: { policy: 'never' },
    secrets: {},
  };

  it('runs agent loop with tool execution and observations', async () => {
    const conversation = new LocalConversation({ settings, llmClient: new FakeStreamingLLM() });
    const events: Event[] = [];
    conversation.on('event', (event) => events.push(event));

    await conversation.startNewConversation();
    await conversation.sendUserMessage('start');

    const actionEvents = events.filter(isActionEvent);
    const observationEvents = events.filter(isObservationEvent);
    const assistantMessages = events.filter(isMessageEvent).filter((event) => event.source === 'agent');

    expect(actionEvents).toHaveLength(1);
    expect(observationEvents).toHaveLength(1);
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
  });
});
