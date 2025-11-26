import { describe, expect, it } from 'vitest';
import { createToolCallErrorEvents } from '../toolCallErrorEvents';

const makeToolCall = (id: string, name: string, args = '{}') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: args },
});

describe('toolCallErrorEvents truncation and normalization', () => {
  it('normalizes whitespace in error messages', () => {
    const toolCall = makeToolCall('t1', 'echo');
    const messy = 'line1\n\n\tline2    with   spaces\nline3';
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, messy);

    expect(agentErrorEvent.error).toBe('line1 line2 with spaces line3');

    const payload = JSON.parse((toolMessageEvent.llm_message.content[0] as { type: 'text'; text: string }).text);
    expect(payload.error).toBe('line1 line2 with spaces line3');
  });

  it('caps long error messages at 4096 chars and appends suffix', () => {
    const toolCall = makeToolCall('t2', 'echo');
    const longBase = 'A'.repeat(10_000);
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, longBase);

    const err = agentErrorEvent.error;
    expect(err.length).toBeLessThanOrEqual(4096);
    expect(err.endsWith('(truncated)')).toBe(true);

    const payload = JSON.parse((toolMessageEvent.llm_message.content[0] as { type: 'text'; text: string }).text);
    const toolErr: string = payload.error;
    expect(toolErr.length).toBeLessThanOrEqual(4096);
    expect(toolErr.endsWith('(truncated)')).toBe(true);
  });
});
