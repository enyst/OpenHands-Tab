import { describe, expect, it } from 'vitest';
import { BrowserTool, FileEditorTool, TaskTrackerTool, TerminalTool } from '../../tools';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { LocalConversation } from './LocalConversation';
import type { Event, MessageEvent } from '../types';
import { isActionEvent, isAgentErrorEvent, isConversationErrorEvent, isMessageEvent, isObservationEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { AgentContext, Skill } from '../context';

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

class RecordingLLM implements LLMClient {
  requests: ChatCompletionRequest[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 5 },
  confirmation: {},
  secrets: {},
};

const createDefaultTools = () => [new TerminalTool(), new FileEditorTool(), new TaskTrackerTool(), new BrowserTool()];

describe('LocalConversation', () => {
  it('emits assistant messages when LLM responds without tools', async () => {
    const llm = new FakeLLM([[{ type: 'text', text: 'Hello world' }, { type: 'finish' }]]);
    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm, tools: createDefaultTools() });

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
        {
          type: 'tool_call_delta',
          id: 'tool_1',
          name: 'task_tracker',
          arguments: '{"command":"view"}',
        },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Tasks listed' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm, tools: createDefaultTools() });
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

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm, tools: createDefaultTools() });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('do something');

    const errors = events.filter(isAgentErrorEvent);
    expect(errors.some((e) => e.error.includes('Error validating args'))).toBe(true);
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

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm, tools: createDefaultTools() });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('call bad tool');

    const error = events.find(isAgentErrorEvent);
    expect(error?.error).toContain('not found');
  });

  it('captures tool validation failures as AgentErrorEvents', async () => {
    const llm = new FakeLLM([
      [
        {
          type: 'tool_call_delta',
          id: 'tool_fail',
          name: 'task_tracker',
          arguments: '{"command":"view","action":"complete"}',
        },
        { type: 'finish' },
      ],
      [{ type: 'text', text: 'Done' }, { type: 'finish' }],
    ]);

    const conversation = new LocalConversation({ settings: baseSettings, llmClient: llm, tools: createDefaultTools() });
    const events: Event[] = [];
    conversation.on('event', (e: Event) => events.push(e));

    await conversation.sendUserMessage('complete unknown task');

    const agentError = events.find(isAgentErrorEvent);
    expect(agentError).toBeDefined();
    expect(agentError?.tool_name).toBe('task_tracker');
    expect(agentError?.tool_call_id).toBe('tool_fail');
    expect(agentError?.error).toContain('Unrecognized key');

    // In this scenario, the failure happens at validation time, so no ConversationErrorEvent is expected.
    const conversationError = events.find(isConversationErrorEvent);
    expect(conversationError).toBeUndefined();
  });

  it('emits ConversationErrorEvent when no LLM API key is available', async () => {
    const envKeys = [
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'LITELLM_API_KEY',
      'ANTHROPIC_API_KEY',
      'LLM_API_KEY',
    ];
    const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];

    try {
      const conversation = new LocalConversation({ settings: baseSettings, tools: createDefaultTools() });
      const events: Event[] = [];
      conversation.on('event', (e: Event) => events.push(e));

      await conversation.sendUserMessage('hi');

      const error = events.find(isConversationErrorEvent);
      expect(error).toBeDefined();
      expect(error?.detail).toContain('Missing API key for LLM provider');
    } finally {
      for (const key of envKeys) {
        const value = previous[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('includes skill extended_content in LLM requests when agentContext is configured', async () => {
    const llm = new RecordingLLM();
    const agentContext = new AgentContext({
      skills: [
        new Skill({
          name: 'e2e-skill',
          content: 'Hello from skill.',
          trigger: { type: 'keyword', keywords: ['banana'] },
        }),
      ],
    });

    const conversation = new LocalConversation({
      settings: baseSettings,
      llmClient: llm,
      tools: createDefaultTools(),
      agentContext,
    });

    await conversation.sendUserMessage('banana');

    expect(llm.requests).toHaveLength(1);
    const req = llm.requests[0];
    const userMessages = req.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content.map((c) => c.type)).toEqual(['text', 'text']);
    const extra = userMessages[0].content[1];
    expect(extra).toEqual(expect.objectContaining({ type: 'text' }));
    if (extra.type === 'text') {
      expect(extra.text).toContain('Hello from skill.');
      expect(extra.text).toContain('<EXTRA_INFO>');
    }
  });
});
