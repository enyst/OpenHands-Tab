import { describe, expect, it } from 'vitest';
import {
  type ActionEvent,
  type AgentErrorEvent,
  type ConversationErrorEvent,
  type ConversationStateUpdateEvent,
  type MessageEvent,
} from '@openhands/agent-sdk-ts';

import { initialLlmStreamingState, reduceLlmStreamingState } from '../llmStreaming';

describe('reduceLlmStreamingState', () => {
  const streamUpdate: ConversationStateUpdateEvent = {
    kind: 'ConversationStateUpdateEvent',
    key: 'llm_stream',
    value: 'partial',
  };

  it('starts and completes streaming on assistant message', () => {
    const start = reduceLlmStreamingState(initialLlmStreamingState, streamUpdate);
    expect(start.started).toBe(true);
    expect(start.state.phase).toBe('streaming');
    expect(start.state.content).toBe('partial');

    const assistantMessage: MessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: { role: 'assistant', content: [] },
    };
    const done = reduceLlmStreamingState(start.state, assistantMessage);
    expect(done.completed).toBe(true);
    expect(done.state.phase).toBe('idle');
    expect(done.state.content).toBeNull();
  });

  it('completes streaming when the first tool call action arrives', () => {
    const start = reduceLlmStreamingState(initialLlmStreamingState, streamUpdate);
    expect(start.state.phase).toBe('streaming');

    const action: ActionEvent = {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'thinking' }],
      action: {},
      tool_name: 'terminal',
      tool_call_id: 'tool-1',
      tool_call: {
        id: 'tool-1',
        type: 'function',
        function: { name: 'terminal', arguments: '{}' },
      },
      llm_response_id: 'resp-1',
    };
    const done = reduceLlmStreamingState(start.state, action);
    expect(done.completed).toBe(true);
    expect(done.state.phase).toBe('idle');
    expect(done.state.content).toBeNull();
  });

  it('clears streaming on agent or conversation errors', () => {
    const start = reduceLlmStreamingState(initialLlmStreamingState, streamUpdate);
    expect(start.state.phase).toBe('streaming');

    const agentError: AgentErrorEvent = {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'failed',
      tool_name: 'terminal',
      tool_call_id: 'tool-1',
    };
    const fromAgentError = reduceLlmStreamingState(start.state, agentError);
    expect(fromAgentError.completed).toBe(true);
    expect(fromAgentError.state.phase).toBe('idle');

    const restart = reduceLlmStreamingState(initialLlmStreamingState, streamUpdate);
    expect(restart.state.phase).toBe('streaming');

    const conversationError: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'agent',
      code: '500',
      detail: 'abort',
    };
    const fromConversationError = reduceLlmStreamingState(restart.state, conversationError);
    expect(fromConversationError.completed).toBe(true);
    expect(fromConversationError.state.phase).toBe('idle');
  });

  it('emits only the incremental portion for subsequent responses', () => {
    const first = reduceLlmStreamingState(initialLlmStreamingState, {
      kind: 'ConversationStateUpdateEvent',
      key: 'llm_stream',
      value: 'Hello',
    });
    expect(first.state.content).toBe('Hello');

    const assistantMessage: MessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: { role: 'assistant', content: [] },
    };
    const completed = reduceLlmStreamingState(first.state, assistantMessage);
    expect(completed.state.phase).toBe('idle');

    const second = reduceLlmStreamingState(completed.state, {
      kind: 'ConversationStateUpdateEvent',
      key: 'llm_stream',
      value: 'HelloWorld',
    });
    expect(second.state.content).toBe('World');
  });

  it('resets offset when global stream shrinks', () => {
    const first = reduceLlmStreamingState(initialLlmStreamingState, {
      kind: 'ConversationStateUpdateEvent',
      key: 'llm_stream',
      value: 'Hello there',
    });
    expect(first.state.content).toBe('Hello there');

    const completed = reduceLlmStreamingState(first.state, {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: { role: 'assistant', content: [] },
    });
    expect(completed.state.phase).toBe('idle');

    const second = reduceLlmStreamingState(completed.state, {
      kind: 'ConversationStateUpdateEvent',
      key: 'llm_stream',
      value: 'Hi',
    });
    expect(second.state.content).toBe('Hi');
    expect(second.started).toBe(true);
  });
});
