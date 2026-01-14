import { describe, it, expect } from 'vitest';
import {
  isEvent,
  isTextContent,
  isImageContent,
  isSystemPromptEvent,
  isActionEvent,
  isObservationEvent,
  isUserRejectObservation,
  isMessageEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isPauseEvent,
  isCondensation,
  isConversationStateUpdateEvent,
  isBashEvent,
  isBashCommand,
  isBashOutput,
  isBashExit,
  type Event,
  type Content,
  type BashEvent,
} from '../index';

describe('Content guards', () => {
  describe('isTextContent', () => {
    it('returns true for text content', () => {
      const content: Content = { type: 'text', text: 'hello' };
      expect(isTextContent(content)).toBe(true);
    });

    it('returns false for image content', () => {
      const content: Content = { type: 'image', image_urls: ['url'] };
      expect(isTextContent(content)).toBe(false);
    });
  });

  describe('isImageContent', () => {
    it('returns true for image content', () => {
      const content: Content = { type: 'image', image_urls: ['url'] };
      expect(isImageContent(content)).toBe(true);
    });

    it('returns false for text content', () => {
      const content: Content = { type: 'text', text: 'hello' };
      expect(isImageContent(content)).toBe(false);
    });
  });
});

describe('Event guards', () => {
  describe('isEvent', () => {
    it('returns true for valid SystemPromptEvent', () => {
      const event = {
        kind: 'SystemPromptEvent',
        source: 'agent',
        system_prompt: { type: 'text', text: 'prompt' },
        tools: [],
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid ActionEvent', () => {
      const event = {
        kind: 'ActionEvent',
        source: 'agent',
        thought: [{ type: 'text', text: 'thinking' }],
        action: {},
        tool_name: 'test',
        tool_call_id: 'id',
        tool_call: { id: 'id', type: 'function', function: { name: 'test', arguments: '{}' } },
        llm_response_id: 'resp',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid ObservationEvent', () => {
      const event = {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: {},
        tool_name: 'test',
        tool_call_id: 'id',
        action_id: 'action',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid MessageEvent', () => {
      const event = {
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid AgentErrorEvent', () => {
      const event = {
        kind: 'AgentErrorEvent',
        source: 'agent',
        error: 'error message',
        tool_name: 'test',
        tool_call_id: 'id',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid ConversationErrorEvent', () => {
      const event = {
        kind: 'ConversationErrorEvent',
        source: 'agent',
        code: 'ERR_001',
        detail: 'Error details',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid PauseEvent', () => {
      const event = {
        kind: 'PauseEvent',
        source: 'user',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid Condensation', () => {
      const event = {
        kind: 'Condensation',
        source: 'environment',
        forgotten_event_ids: ['id1', 'id2'],
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid ConversationStateUpdateEvent', () => {
      const event = {
        kind: 'ConversationStateUpdateEvent',
        source: 'agent',
        iteration: 1,
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns true for valid UserRejectObservation', () => {
      const event = {
        kind: 'UserRejectObservation',
        source: 'environment',
        rejection_reason: 'User rejected',
        tool_name: 'test',
        tool_call_id: 'id',
        action_id: 'action',
      };
      expect(isEvent(event)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isEvent(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isEvent(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isEvent('string')).toBe(false);
    });

    it('returns false for missing kind', () => {
      expect(isEvent({ source: 'agent' })).toBe(false);
    });

    it('returns false for unknown kind', () => {
      expect(isEvent({ kind: 'UnknownEvent' })).toBe(false);
    });
  });

  describe('Event kind guards', () => {
    const systemPromptEvent: Event = {
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: 'prompt' },
      tools: [],
    };

    const actionEvent: Event = {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'thinking' }],
      action: {},
      tool_name: 'test',
      tool_call_id: 'id',
      tool_call: { id: 'id', type: 'function', function: { name: 'test', arguments: '{}' } },
      llm_response_id: 'resp',
    };

    const observationEvent: Event = {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: {},
      tool_name: 'test',
      tool_call_id: 'id',
      action_id: 'action',
    };

    const messageEvent: Event = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    };

    it('isSystemPromptEvent correctly identifies', () => {
      expect(isSystemPromptEvent(systemPromptEvent)).toBe(true);
      expect(isSystemPromptEvent(actionEvent)).toBe(false);
    });

    it('isActionEvent correctly identifies', () => {
      expect(isActionEvent(actionEvent)).toBe(true);
      expect(isActionEvent(messageEvent)).toBe(false);
    });

    it('isObservationEvent correctly identifies', () => {
      expect(isObservationEvent(observationEvent)).toBe(true);
      expect(isObservationEvent(actionEvent)).toBe(false);
    });

    it('isMessageEvent correctly identifies', () => {
      expect(isMessageEvent(messageEvent)).toBe(true);
      expect(isMessageEvent(actionEvent)).toBe(false);
    });

    it('isConversationStateUpdateEvent correctly identifies', () => {
      const event: Event = { kind: 'ConversationStateUpdateEvent', source: 'agent' };
      expect(isConversationStateUpdateEvent(event)).toBe(true);
      expect(isConversationStateUpdateEvent(actionEvent)).toBe(false);
    });

    it('isPauseEvent correctly identifies', () => {
      const event: Event = { kind: 'PauseEvent', source: 'user' };
      expect(isPauseEvent(event)).toBe(true);
      expect(isPauseEvent(actionEvent)).toBe(false);
    });

    it('isCondensation correctly identifies', () => {
      const event: Event = {
        kind: 'Condensation',
        source: 'environment',
        forgotten_event_ids: [],
      };
      expect(isCondensation(event)).toBe(true);
      expect(isCondensation(actionEvent)).toBe(false);
    });

    it('isAgentErrorEvent correctly identifies', () => {
      const event: Event = {
        kind: 'AgentErrorEvent',
        source: 'agent',
        error: 'error',
        tool_name: 'test',
        tool_call_id: 'id',
      };
      expect(isAgentErrorEvent(event)).toBe(true);
      expect(isAgentErrorEvent(actionEvent)).toBe(false);
    });

    it('isConversationErrorEvent correctly identifies', () => {
      const event: Event = {
        kind: 'ConversationErrorEvent',
        source: 'agent',
        detail: 'error',
      };
      expect(isConversationErrorEvent(event)).toBe(true);
      expect(isConversationErrorEvent(actionEvent)).toBe(false);
    });

    it('isUserRejectObservation correctly identifies', () => {
      const event: Event = {
        kind: 'UserRejectObservation',
        source: 'environment',
        rejection_reason: 'rejected',
        tool_name: 'test',
        tool_call_id: 'id',
        action_id: 'action',
      };
      expect(isUserRejectObservation(event)).toBe(true);
      expect(isUserRejectObservation(actionEvent)).toBe(false);
    });
  });
});

describe('Bash event guards', () => {
  describe('isBashEvent', () => {
    it('returns true for valid BashCommand', () => {
      const event = {
        id: '1',
        type: 'BashCommand',
        timestamp: '2024-01-01T00:00:00Z',
        command_id: 'cmd1',
        order: 0,
        command: 'ls -la',
      };
      expect(isBashEvent(event)).toBe(true);
    });

    it('returns true for valid BashOutput', () => {
      const event = {
        id: '2',
        type: 'BashOutput',
        timestamp: '2024-01-01T00:00:00Z',
        command_id: 'cmd1',
        order: 1,
        exit_code: 0,
        stdout: 'output',
        stderr: null,
      };
      expect(isBashEvent(event)).toBe(true);
    });

    it('returns true for valid BashExit', () => {
      const event = {
        id: '3',
        type: 'BashExit',
        timestamp: '2024-01-01T00:00:00Z',
        command_id: 'cmd1',
        order: 2,
        exit_code: 0,
      };
      expect(isBashEvent(event)).toBe(true);
    });

    it('returns false for invalid object', () => {
      expect(isBashEvent({})).toBe(false);
      expect(isBashEvent(null)).toBe(false);
      expect(isBashEvent('string')).toBe(false);
    });

    it('returns false for missing required fields', () => {
      expect(isBashEvent({ type: 'BashCommand' })).toBe(false);
      expect(isBashEvent({ type: 'BashCommand', command_id: 'id' })).toBe(false);
    });
  });

  describe('Bash event kind guards', () => {
    const bashCommand: BashEvent = {
      id: '1',
      type: 'BashCommand',
      timestamp: '2024-01-01T00:00:00Z',
      command_id: 'cmd1',
      order: 0,
      command: 'ls',
    };

    const bashOutput: BashEvent = {
      id: '2',
      type: 'BashOutput',
      timestamp: '2024-01-01T00:00:00Z',
      command_id: 'cmd1',
      order: 1,
      exit_code: 0,
      stdout: 'output',
      stderr: null,
    };

    const bashExit: BashEvent = {
      id: '3',
      type: 'BashExit',
      timestamp: '2024-01-01T00:00:00Z',
      command_id: 'cmd1',
      order: 2,
      exit_code: 0,
    };

    it('isBashCommand correctly identifies', () => {
      expect(isBashCommand(bashCommand)).toBe(true);
      expect(isBashCommand(bashOutput)).toBe(false);
      expect(isBashCommand(bashExit)).toBe(false);
    });

    it('isBashOutput correctly identifies', () => {
      expect(isBashOutput(bashOutput)).toBe(true);
      expect(isBashOutput(bashCommand)).toBe(false);
      expect(isBashOutput(bashExit)).toBe(false);
    });

    it('isBashExit correctly identifies', () => {
      expect(isBashExit(bashExit)).toBe(true);
      expect(isBashExit(bashCommand)).toBe(false);
      expect(isBashExit(bashOutput)).toBe(false);
    });
  });
});
