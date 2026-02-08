import { describe, expect, it } from 'vitest';
import type { Event } from '../../../sdk/types';
import { DelegationVisualizer } from '../DelegationVisualizer';

describe('DelegationVisualizer', () => {
  it('formats user message without sender', () => {
    const viz = new DelegationVisualizer({ name: 'MainAgent' });
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      } as any,
    ];
    expect(viz.render(events)).toContain('### User Message to Main Agent Agent');
  });

  it('formats user message with sender', () => {
    const viz = new DelegationVisualizer({ name: 'Lodging Expert' });
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'user',
        sender: 'Delegator',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'Task from parent' }] },
      } as any,
    ];
    expect(viz.render(events)).toContain('### Delegator Agent Message to Lodging Expert Agent');
  });

  it('formats agent response to user', () => {
    const viz = new DelegationVisualizer({ name: 'MainAgent' });
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: { role: 'assistant', content: [{ type: 'text', text: 'Response to user' }] },
      } as any,
    ];
    expect(viz.render(events)).toContain('### Message from Main Agent Agent to User');
  });

  it('formats agent response to delegator based on last delegated user message', () => {
    const viz = new DelegationVisualizer({ name: 'Lodging Expert' });
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'user',
        sender: 'Delegator',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'Task from parent' }] },
      } as any,
      {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: { role: 'assistant', content: [{ type: 'text', text: 'Response to delegator' }] },
      } as any,
    ];
    expect(viz.render(events)).toContain('### Lodging Expert Agent Message to Delegator Agent');
  });

  it('formats snake_case agent names', () => {
    const viz = new DelegationVisualizer({ name: 'lodging_expert' });
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'user',
        sender: 'main_delegator',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'Task' }] },
      } as any,
      {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      } as any,
    ];
    const rendered = viz.render(events);
    expect(rendered).toContain('### Main Delegator Agent Message to Lodging Expert Agent');
    expect(rendered).toContain('### Lodging Expert Agent Message to Main Delegator Agent');
  });

  it('includes agent name for actions and observations', () => {
    const viz = new DelegationVisualizer({ name: 'lodging_expert' });
    const events: Event[] = [
      { kind: 'ActionEvent', tool_name: 'search' } as any,
      { kind: 'ObservationEvent', tool_name: 'search' } as any,
    ];
    const rendered = viz.render(events);
    expect(rendered).toContain('### Lodging Expert Agent Action (search)');
    expect(rendered).toContain('### Lodging Expert Agent Observation (search)');
  });
});

