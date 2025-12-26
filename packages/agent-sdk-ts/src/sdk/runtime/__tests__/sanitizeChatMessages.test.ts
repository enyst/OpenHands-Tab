import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '../../types';
import { sanitizeChatMessages } from '../sanitizeChatMessages';

const toolCall = (id: string): ToolCall => ({
  id,
  type: 'function',
  function: { name: 'terminal', arguments: '{"command":"echo hi"}' },
});

describe('sanitizeChatMessages', () => {
  it('drops orphan tool messages', () => {
    const messages: Message[] = [
      { role: 'tool', name: 'terminal', tool_call_id: 'call_1', content: [{ type: 'text', text: 'hi' }] },
    ];
    expect(sanitizeChatMessages(messages)).toEqual([]);
  });

  it('keeps only tool_calls that have tool responses', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Running tools' }],
        tool_calls: [toolCall('call_1'), toolCall('call_2')],
      },
      { role: 'tool', name: 'terminal', tool_call_id: 'call_1', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: [{ type: 'text', text: 'next' }] },
    ];

    const sanitized = sanitizeChatMessages(messages);
    expect(sanitized).toHaveLength(3);
    expect(sanitized[0]?.role).toBe('assistant');
    expect(sanitized[0]?.tool_calls?.map((c) => c.id)).toEqual(['call_1']);
    expect(sanitized[1]).toEqual(messages[1]);
    expect(sanitized[2]).toEqual(messages[2]);
  });

  it('removes tool_calls when no tool responses exist but keeps meaningful assistant content', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I will try a tool.' }],
        tool_calls: [toolCall('call_1')],
      },
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
    ];

    const sanitized = sanitizeChatMessages(messages);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0]?.role).toBe('assistant');
    expect(sanitized[0]?.tool_calls).toBeUndefined();
  });

  it('drops assistant messages that only contained orphan tool_calls and no meaningful content', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '   ' }],
        tool_calls: [toolCall('call_1')],
      },
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
    ];

    const sanitized = sanitizeChatMessages(messages);
    expect(sanitized).toEqual([messages[1]]);
  });
});

