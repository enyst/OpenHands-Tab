import { describe, expect, it } from 'vitest';
import type { Event } from '../../types';
import { ConversationVisualizer } from '..';

describe('ConversationVisualizer', () => {
  it('renders basic markdown sections', () => {
    const events: Event[] = [
      {
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      } as Event,
      {
        kind: 'ActionEvent',
        source: 'agent',
        thought: [{ type: 'text', text: 'do thing' }],
        action: { command: 'pwd' },
        tool_name: 'terminal',
        tool_call_id: 'tc-1',
        tool_call: { id: 'tc-1', type: 'function', function: { name: 'terminal', arguments: '{}' } },
        llm_response_id: 'r-1',
      } as Event,
    ];

    const viz = new ConversationVisualizer({ includeTimestamps: false, skipStateUpdates: true });
    const markdown = viz.render(events);

    expect(markdown).toContain('### Message (user)');
    expect(markdown).toContain('hi');
    expect(markdown).toContain('### Action (terminal)');
    expect(markdown).toContain('"command": "pwd"');
  });
});
