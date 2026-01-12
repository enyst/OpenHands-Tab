import { describe, expect, it } from 'vitest';
import { resolveToolsWithDefaultTools } from '../includeDefaultTools';

type TestTool = { name: string; custom?: boolean };

describe('resolveToolsWithDefaultTools', () => {
  it('throws on unknown default tool name', () => {
    expect(() =>
      resolveToolsWithDefaultTools({
        includeDefaultTools: ['nope'],
        hasToolsOption: false,
        defaultTools: [{ name: 'terminal' }, { name: 'file_editor' }] satisfies TestTool[],
        providedTools: undefined,
      }),
    ).toThrow(/unknown default tool 'nope'/i);
  });

  it('merges selected defaults with provided tools, preserving default ordering', () => {
    const defaultTools: TestTool[] = [{ name: 'terminal' }, { name: 'file_editor' }];
    const providedTools: TestTool[] = [{ name: 'terminal', custom: true }, { name: 'glob' }];

    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: ['terminal'],
      hasToolsOption: false,
      defaultTools,
      providedTools,
    });

    expect(tools.map((t) => t.name)).toEqual(['terminal', 'glob']);
    expect(tools[0].custom).toBe(true);
  });
});
