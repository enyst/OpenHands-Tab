import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_ERROR_MESSAGE, visualizeConversationErrorEvent, type ConversationErrorEvent } from '../index';

describe('visualizeConversationErrorEvent', () => {
  it('renders code + detail when present', () => {
    const event: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'agent',
      code: 'context_limit',
      detail: 'Model context window exceeded',
    };

    expect(visualizeConversationErrorEvent(event)).toBe('code: context_limit\ndetail: Model context window exceeded');
  });

  it('renders only code when detail is empty', () => {
    const event: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'agent',
      code: 'timeout',
      detail: '   ',
    };

    expect(visualizeConversationErrorEvent(event)).toBe('code: timeout');
  });

  it('falls back to a generic label when code/detail are missing', () => {
    const event: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'agent',
    };

    expect(visualizeConversationErrorEvent(event)).toBe(DEFAULT_CONVERSATION_ERROR_MESSAGE);
  });
});
