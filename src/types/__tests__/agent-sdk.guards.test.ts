import { describe, it, expect } from 'vitest';
import { isEvent, isMessageEvent, isTextContent, type Event, type Message } from '../../types/agent-sdk';

describe('agent-sdk type guards', () => {
  it('validates MessageEvent with text content', () => {
    const payload: Event = {
      type: 'message',
      message: {
        role: 'user',
        content: [ { type: 'text', text: 'Hello' } ]
      }
    } as any;
    expect(isEvent(payload)).toBe(true);
    expect(isMessageEvent(payload)).toBe(true);
    const msg = (payload as any).message as Message;
    expect(Array.isArray(msg.content)).toBe(true);
    expect(isTextContent(msg.content[0] as any)).toBe(true);
  });

  it('rejects invalid event structures', () => {
    expect(isEvent(null as any)).toBe(false);
    expect(isEvent({} as any)).toBe(false);
    expect(isEvent({ type: 'message' } as any)).toBe(false);
    expect(isEvent({ type: 'system', message: 123 } as any)).toBe(false);
  });
});
