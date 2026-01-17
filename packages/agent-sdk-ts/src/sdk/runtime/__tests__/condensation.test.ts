import { describe, expect, it, vi } from 'vitest';
import type { Event } from '../../types';
import type { LLMToolDefinition } from '../../llm';
import { buildChatRequestWithCondensation, getCondensationState, tryCondenseConversation } from '../condensation';

describe('condensation helpers', () => {
  it('getCondensationState unions forgotten ids and keeps latest non-empty summary', () => {
    const events: Event[] = [
      {
        kind: 'Condensation',
        source: 'environment',
        forgotten_event_ids: ['a', 'b', ' '],
        summary: 'first',
        summary_offset: 2,
      },
      { kind: 'Condensation', source: 'environment', forgotten_event_ids: ['c'], summary: '   ', summary_offset: 3 },
      { kind: 'Condensation', source: 'environment', forgotten_event_ids: ['d'], summary: ' latest ', summary_offset: 5 },
    ];

    const state = getCondensationState(events);
    expect(state.summary).toBe('latest');
    expect(state.summaryOffset).toBe(5);
    expect(Array.from(state.forgottenEventIds).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('buildChatRequestWithCondensation injects summary and filters forgotten messages', () => {
    const message1 = {
      kind: 'MessageEvent',
      id: 'm1',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      extended_content: [{ type: 'text', text: 'Context' }],
    } satisfies Extract<Event, { kind: 'MessageEvent' }>;

    const message2 = {
      kind: 'MessageEvent',
      id: 'm2',
      source: 'agent',
      llm_message: { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
    } satisfies Extract<Event, { kind: 'MessageEvent' }>;

    const condense = {
      kind: 'Condensation',
      source: 'environment',
      forgotten_event_ids: ['m2'],
      summary: 'short summary',
      summary_offset: 4,
    } satisfies Extract<Event, { kind: 'Condensation' }>;

    const tools: LLMToolDefinition[] = [];
    const request = buildChatRequestWithCondensation({
      events: [message1, message2, condense],
      systemPrompt: 'SYS',
      tools,
    });

    expect(request.systemPrompt).toContain('SYS');
    expect(request.systemPrompt).toContain('<CONVERSATION SUMMARY>');
    expect(request.systemPrompt).toContain('short summary');

    expect(request.messages.map((m) => m.role)).toEqual(['user']);
    const userMessage = request.messages[0]!;
    expect(userMessage.content).toEqual([{ type: 'text', text: 'Hello' }, { type: 'text', text: 'Context' }]);
  });

  it('only keeps <environment information> for the most recent user message', () => {
    const message1 = {
      kind: 'MessageEvent',
      id: 'm1',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'First' }] },
      extended_content: [
        { type: 'text', text: '<environment information>\nActive editor: a.ts\n</environment information>' },
        { type: 'text', text: 'Environment note: user edited file:\n/tmp/a.txt' },
      ],
    } satisfies Extract<Event, { kind: 'MessageEvent' }>;

    const message2 = {
      kind: 'MessageEvent',
      id: 'm2',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'Second' }] },
      extended_content: [{ type: 'text', text: '<environment information>\nActive editor: b.ts\n</environment information>' }],
    } satisfies Extract<Event, { kind: 'MessageEvent' }>;

    const tools: LLMToolDefinition[] = [];
    const request = buildChatRequestWithCondensation({
      events: [message1, message2],
      systemPrompt: 'SYS',
      tools,
    });

    expect(request.messages.map((m) => m.role)).toEqual(['user', 'user']);
    expect(request.messages[0]?.content).toEqual([
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Environment note: user edited file:\n/tmp/a.txt' },
    ]);
    expect(request.messages[1]?.content).toEqual([
      { type: 'text', text: 'Second' },
      { type: 'text', text: '<environment information>\nActive editor: b.ts\n</environment information>' },
    ]);
  });

  it('tryCondenseConversation emits a Condensation event using injected condense()', async () => {
    const events: Event[] = [
      { kind: 'MessageEvent', id: 'a', source: 'user', llm_message: { role: 'user', content: [{ type: 'text', text: 'a' }] } },
      { kind: 'MessageEvent', id: 'b', source: 'user', llm_message: { role: 'user', content: [{ type: 'text', text: 'b' }] } },
      { kind: 'MessageEvent', id: 'c', source: 'user', llm_message: { role: 'user', content: [{ type: 'text', text: 'c' }] } },
    ];

    const pushed: Event[] = [];
    const condenseSpy = vi.fn(async () => ({ summary: 'S', forgottenEventIds: ['b'], summaryOffset: 4 }));
    const getPrimaryLlmClient = vi.fn(async () => {
      throw new Error('should not be called');
    });

    await expect(
      tryCondenseConversation({
        maxInputTokens: 123,
        listEvents: () => events,
        pushEvent: async (event) => {
          pushed.push(event);
        },
        condense: condenseSpy,
        getPrimaryLlmClient,
      }),
    ).resolves.toBe(true);

    expect(getPrimaryLlmClient).not.toHaveBeenCalled();
    expect(condenseSpy).toHaveBeenCalledWith({
      events,
      previousSummary: '',
      maxInputTokens: 123,
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      kind: 'Condensation',
      source: 'environment',
      forgotten_event_ids: ['b'],
      summary: 'S',
      summary_offset: 4,
    });
  });
});
