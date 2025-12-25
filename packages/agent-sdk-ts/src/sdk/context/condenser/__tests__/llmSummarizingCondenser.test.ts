import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../../llm';
import { EventLog } from '../../../runtime/EventLog';
import type { Event } from '../../../types';
import { LLMSummarizingCondenser } from '../llmSummarizingCondenser';

class RecordingLLM implements LLMClient {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(private readonly chunks: string[]) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    for (const chunk of this.chunks) {
      yield { type: 'text', text: chunk };
    }
    yield { type: 'finish' };
  }
}

const addMessageEvent = (log: EventLog, role: 'user' | 'assistant' | 'tool', text: string): Event => {
  return log.push({
    kind: 'MessageEvent',
    source: role === 'user' ? 'user' : role === 'assistant' ? 'agent' : 'environment',
    llm_message: { role, content: [{ type: 'text', text }] },
  } as Event);
};

describe('LLMSummarizingCondenser', () => {
  it('builds a prompt with previous summary and parses streamed response text', async () => {
    const log = new EventLog();
    addMessageEvent(log, 'user', 'Hello.');
    addMessageEvent(log, 'assistant', 'Hi!');
    addMessageEvent(log, 'user', 'A'.repeat(2500));
    addMessageEvent(log, 'assistant', 'B'.repeat(2500));
    addMessageEvent(log, 'user', 'C'.repeat(2500));
    addMessageEvent(log, 'assistant', 'D'.repeat(2500));

    const llm = new RecordingLLM(['Summary part 1, ', 'part 2.']);
    const condenser = new LLMSummarizingCondenser(llm, {
      keepFirst: 2,
      maxInputTokens: 1400,
      reservedSummaryTokens: 512,
      targetFraction: 0.5,
    });

    const result = await condenser.condense({ events: log.list(), previousSummary: 'Prior summary.' });
    expect(result).toBeDefined();
    expect(result?.summary).toBe('Summary part 1, part 2.');
    expect(result?.summaryOffset).toBe(2);
    expect(result?.forgottenEventIds.length).toBeGreaterThan(0);

    expect(llm.requests).toHaveLength(1);
    const promptPart = llm.requests[0].messages[0].content[0];
    expect(promptPart.type).toBe('text');
    if (promptPart.type === 'text') {
      expect(promptPart.text).toContain('<PREVIOUS SUMMARY>');
      expect(promptPart.text).toContain('Prior summary.');
      expect(promptPart.text).toContain('</PREVIOUS SUMMARY>');
      expect(promptPart.text).toContain('<EVENT>');
      expect(promptPart.text).toContain('MessageEvent');
      expect(promptPart.text).toContain('Now summarize the events');
    }
  });

  it('clips the prompt to fit the token budget (best-effort)', async () => {
    const log = new EventLog();
    addMessageEvent(log, 'user', 'Intro.');
    addMessageEvent(log, 'assistant', 'Ack.');

    for (let i = 0; i < 12; i += 1) {
      addMessageEvent(log, i % 2 === 0 ? 'user' : 'assistant', `${i}: ${'x'.repeat(2000)}`);
    }

    const llm = new RecordingLLM(['OK']);
    const condenser = new LLMSummarizingCondenser(llm, {
      keepFirst: 2,
      maxInputTokens: 900,
      reservedSummaryTokens: 100,
      targetFraction: 0.5,
      maxEventTokens: 200,
    });

    const result = await condenser.condense({ events: log.list(), previousSummary: '' });
    expect(result).toBeDefined();
    expect(result?.forgottenEventIds.length).toBeGreaterThan(0);

    expect(llm.requests).toHaveLength(1);
    const promptPart = llm.requests[0].messages[0].content[0];
    expect(promptPart.type).toBe('text');
    if (promptPart.type === 'text') {
      // estimateTokens is ceil(chars/4), so keeping <= maxInputTokens*4 chars guarantees we fit.
      expect(promptPart.text.length).toBeLessThanOrEqual(900 * 4);
    }
  });
});

