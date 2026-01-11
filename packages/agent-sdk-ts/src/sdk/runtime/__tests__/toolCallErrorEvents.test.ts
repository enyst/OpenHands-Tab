import { describe, expect, it } from 'vitest';
import { createToolCallErrorEvents } from '../toolCallErrorEvents';

const makeToolCall = (id: string, name: string, args = '{}') => ({
  id,
  type: 'function' as const,
  function: { name, arguments: args },
});

describe('toolCallErrorEvents truncation and normalization', () => {
  it('preserves raw whitespace in error messages (python parity)', () => {
    const toolCall = makeToolCall('t1', 'echo');
    const messy = 'line1\n\n\tline2    with   spaces\nline3';
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, messy);

    expect(agentErrorEvent.error).toBe(messy);

    const text = (toolMessageEvent.llm_message.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe(messy);
  });

  it('clips long tool error messages for LLM using the shared tool-message clip marker', () => {
    const toolCall = makeToolCall('t2', 'echo');
    const longBase = 'A'.repeat(10_000);
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, longBase);

    const err = agentErrorEvent.error;
    expect(err).toBe(longBase);

    const toolErr = (toolMessageEvent.llm_message.content[0] as { type: 'text'; text: string }).text;
    expect(toolErr.length).toBeLessThanOrEqual(8000);
    expect(toolErr).toContain('<response clipped>');
  });
});
