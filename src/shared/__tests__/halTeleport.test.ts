import { describe, expect, it } from 'vitest';
import type { Event } from '@openhands/agent-sdk-ts';
import { renderCondensationSummarizingPrompt, takeLastTeleportableEvents } from '../halTeleport';

describe('takeLastTeleportableEvents', () => {
  it('filters to Action/Observation/Message (user/assistant) and keeps order', () => {
    const events: Event[] = [
      { kind: 'ConversationStateUpdateEvent', source: 'agent' } as unknown as Event,
      {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
      } as unknown as Event,
      {
        kind: 'ActionEvent',
        source: 'agent',
        thought: [{ type: 'text', text: 't' }],
        action: { kind: 'TerminalAction', command: 'pwd' },
        tool_name: 'terminal',
        tool_call_id: 'call_1',
        tool_call: { id: 'call_1', type: 'function', function: { name: 'terminal', arguments: '{}' } },
        llm_response_id: 'resp_1',
      } as unknown as Event,
      {
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      } as unknown as Event,
      { kind: 'Condensation', source: 'environment', forgotten_event_ids: [] } as unknown as Event,
      {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: { kind: 'TerminalObservation', content: [] },
        tool_name: 'terminal',
        tool_call_id: 'call_1',
        action_id: 'a1',
      } as unknown as Event,
    ];

    const picked = takeLastTeleportableEvents(events, 10);
    expect(picked.map((e) => e.kind)).toEqual(['ActionEvent', 'MessageEvent', 'ObservationEvent']);
  });

  it('limits to last N', () => {
    const events: Event[] = [
      { kind: 'ActionEvent', source: 'agent' } as unknown as Event,
      { kind: 'ObservationEvent', source: 'environment' } as unknown as Event,
      {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      } as unknown as Event,
    ];
    const picked = takeLastTeleportableEvents(events, 2);
    expect(picked.map((e) => e.kind)).toEqual(['ObservationEvent', 'MessageEvent']);
  });
});

describe('renderCondensationSummarizingPrompt', () => {
  it('includes previous summary and event wrappers', () => {
    const rendered = renderCondensationSummarizingPrompt({
      previousSummary: 'prev',
      eventStrings: ['{"kind":"MessageEvent"}', '{"kind":"ActionEvent"}'],
    });
    expect(rendered).toContain('<PREVIOUS SUMMARY>');
    expect(rendered).toContain('prev');
    expect(rendered).toContain('<EVENT>');
    expect(rendered).toContain('{"kind":"MessageEvent"}');
    expect(rendered).toContain('Now summarize the events using the rules above.');
  });
});

