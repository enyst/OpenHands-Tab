import { describe, expect, it } from 'vitest';
import { resolveToolsWithDefaultTools } from '../includeDefaultTools';

describe('resolveToolsWithDefaultTools', () => {
  it('throws on unknown default tool name', () => {
    expect(() =>
      resolveToolsWithDefaultTools({
        includeDefaultTools: ['nope'],
        hasToolsOption: false,
        defaultTools: [{ name: 'terminal' }, { name: 'file_editor' }],
        providedTools: undefined,
      }),
    ).toThrow(/unknown default tool 'nope'/i);
  });

  it('merges selected defaults with provided tools, preserving default ordering', () => {
    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: ['terminal'],
      hasToolsOption: false,
      defaultTools: [{ name: 'terminal' }, { name: 'file_editor' }],
      providedTools: [{ name: 'terminal', custom: true } as any, { name: 'glob' } as any],
    });

    expect(tools.map((t) => t.name)).toEqual(['terminal', 'glob']);
    expect((tools[0] as any).custom).toBe(true);
  });
});

