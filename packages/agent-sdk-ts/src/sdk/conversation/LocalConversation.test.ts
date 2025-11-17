import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { LocalConversation } from './LocalConversation';
import type { Event, MessageEvent } from '../types';
import { isActionEvent, isAgentErrorEvent, isMessageEvent, isObservationEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';

class FakeLLM implements LLMClient {
  private readonly responses: LLMStreamChunk[][];

  constructor(responses: LLMStreamChunk[][]) {
    this.responses = responses;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
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
    conversation.on('event', (e: Event) => events.push(e));

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
    conversation.on('event', (e: Event) => events.push(e));

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

  it('records AgentErrorEvents when tool args JSON is invalid', async () => {
    const llm = new FakeLLM([
      [
        { type: 'tool_call_delta', id: 'tool_bad', name: 'task_tracker', arguments: '{"action":"list"' },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Recovered' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('do something');

    const errors = events.filter(isAgentErrorEvent);
    expect(errors.some((e) => e.error.includes('Invalid tool arguments'))).toBe(true);
    const finalAssistant = events
      .filter((e): e is MessageEvent => isMessageEvent(e) && e.source === 'agent')
      .pop();
    expect(finalAssistant?.llm_message.content[0]).toEqual({ type: 'text', text: 'Recovered' });
  });

  it('emits AgentErrorEvent for unknown tools', async () => {
    const llm = new FakeLLM([
      [
        { type: 'tool_call_delta', id: 'tool_unknown', name: 'nonexistent', arguments: '{"any":"value"}' },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Handled' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('call bad tool');

    const error = events.find(isAgentErrorEvent);
    expect(error?.error).toContain('Unknown tool');
  });

  it('captures tool execution failures as AgentErrorEvents', async () => {
    const llm = new FakeLLM([
      [
        { type: 'tool_call_delta', id: 'tool_fail', name: 'task_tracker', arguments: '{"action":"complete"}' },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Done' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('complete unknown task');

    const error = events.find(isAgentErrorEvent);
    expect(error?.error).toContain('id is required');
  });
});
