import { describe, it, expect } from 'vitest';
import { isEvent, isMessageEvent, isTextContent, type MessageEvent } from '../../types/agent-sdk';

describe('agent-sdk type guards', () => {
  it('validates MessageEvent with text content', () => {
    const payload: MessageEvent = {
      type: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [ { type: 'text', text: 'Hello' } ]
      }
    };
    expect(isEvent(payload)).toBe(true);
    expect(isMessageEvent(payload)).toBe(true);
    expect(Array.isArray(payload.llm_message.content)).toBe(true);
    expect(isTextContent(payload.llm_message.content[0])).toBe(true);
  });

  it('rejects invalid event structures', () => {
    expect(isEvent(null as any)).toBe(false);
    expect(isEvent({} as any)).toBe(false);
    expect(isEvent({ type: 'MessageEvent' } as any)).toBe(false);
    expect(isEvent({ type: 'MessageEvent', llm_message: null } as any)).toBe(false);
  });

  it('accepts ConversationErrorEvent payloads', () => {
    const payload = {
      type: 'ConversationErrorEvent',
      source: 'environment' as const,
      code: 'LLMBadRequestError',
      detail: 'Unsupported reasoning effort'
    };
    expect(isEvent(payload)).toBe(true);
  });
});
