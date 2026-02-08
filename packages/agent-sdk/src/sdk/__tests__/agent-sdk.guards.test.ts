import { describe, it, expect } from 'vitest';
import {
  isActionEvent,
  isBashCommand,
  isBashEvent,
  isBashExit,
  isBashOutput,
  isConversationErrorEvent,
  isEvent,
  isMessageEvent,
  isSystemPromptEvent,
  isTextContent,
  type ActionEvent,
  type BashCommand,
  type BashExit,
  type BashOutput,
  type ConversationErrorEvent,
  type MessageEvent,
  type SystemPromptEvent,
} from '../index';

describe('agent-sdk type guards', () => {
  it('validates MessageEvent with text content', () => {
    const payload: MessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    };
    expect(isEvent(payload)).toBe(true);
    expect(isMessageEvent(payload)).toBe(true);
    expect(Array.isArray(payload.llm_message.content)).toBe(true);
    expect(isTextContent(payload.llm_message.content[0])).toBe(true);
  });

  it('accepts core agent events expected from the Python agent', () => {
    const action: ActionEvent = {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'running tool' }],
      action: { name: 'echo', parameters: ['hello'] },
      tool_name: 'bash',
      tool_call_id: 'call-1',
      tool_call: {
        id: 'call-1',
        type: 'function',
        function: { name: 'bash', arguments: '{"cmd":"echo"}' },
      },
      llm_response_id: 'resp-1',
      reasoning_content: null,
    };
    const systemPrompt: SystemPromptEvent = {
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: 'You are OpenHands.' },
      tools: [{ name: 'bash', description: 'Execute shell commands' }],
    };
    const convoError: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'environment',
      code: 'LLMBadRequestError',
    };

    expect(isEvent(action)).toBe(true);
    expect(isActionEvent(action)).toBe(true);
    expect(isEvent(systemPrompt)).toBe(true);
    expect(isSystemPromptEvent(systemPrompt)).toBe(true);
    expect(isEvent(convoError)).toBe(true);
    expect(isConversationErrorEvent(convoError)).toBe(true);
  });

  it('rejects invalid event structures', () => {
    expect(isEvent(null as any)).toBe(false);
    expect(isEvent({} as any)).toBe(false);
    expect(isEvent({ kind: 'MessageEvent' } as any)).toBe(false);
    expect(isEvent({ kind: 'MessageEvent', llm_message: null } as any)).toBe(false);
    expect(isEvent({ kind: 'ActionEvent', tool_name: 'bash' } as any)).toBe(false);
  });

  it('validates bash stream payloads', () => {
    const command: BashCommand = {
      id: 'cmd-1',
      type: 'BashCommand',
      timestamp: '2024-01-01T00:00:00Z',
      command_id: 'cmd-1',
      order: 0,
      command: 'echo hello',
    };
    const output: BashOutput = {
      id: 'cmd-1',
      type: 'BashOutput',
      timestamp: '2024-01-01T00:00:01Z',
      command_id: 'cmd-1',
      order: 1,
      exit_code: null,
      stdout: 'hello',
      stderr: '',
    };
    const exit: BashExit = {
      id: 'cmd-1',
      type: 'BashExit',
      timestamp: '2024-01-01T00:00:02Z',
      command_id: 'cmd-1',
      order: 2,
      exit_code: 0,
    };

    expect(isBashEvent(command)).toBe(true);
    expect(isBashCommand(command)).toBe(true);
    expect(isBashEvent(output)).toBe(true);
    expect(isBashOutput(output)).toBe(true);
    expect(isBashEvent(exit)).toBe(true);
    expect(isBashExit(exit)).toBe(true);
  });

  it('rejects malformed bash payloads', () => {
    expect(isBashEvent({} as any)).toBe(false);
    expect(
      isBashEvent({
        id: 'cmd-1',
        type: 'BashCommand',
        timestamp: '2024-01-01T00:00:00Z',
        order: 0,
        command: 'echo',
      } as any),
    ).toBe(false);
    expect(
      isBashEvent({
        id: 'cmd-1',
        type: 'BashOutput',
        timestamp: '2024-01-01T00:00:01Z',
        command_id: 'cmd-1',
        order: 1,
        stdout: 'hello',
        stderr: '',
      } as any),
    ).toBe(false);
  });
});
