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

  it('defaults to default tools when includeDefaultTools is undefined and tools option is omitted', () => {
    const defaultTools: TestTool[] = [{ name: 'terminal' }, { name: 'file_editor' }];

    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: undefined,
      hasToolsOption: false,
      defaultTools,
      providedTools: undefined,
    });

    expect(tools.map((t) => t.name)).toEqual(['terminal', 'file_editor']);
  });

  it('preserves provided tools when includeDefaultTools is undefined and tools option is explicitly passed', () => {
    const defaultTools: TestTool[] = [{ name: 'terminal' }, { name: 'file_editor' }];
    const providedTools: TestTool[] = [{ name: 'glob' }];

    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: undefined,
      hasToolsOption: true,
      defaultTools,
      providedTools,
    });

    expect(tools.map((t) => t.name)).toEqual(['glob']);
  });

  it('excludes defaults when includeDefaultTools is false', () => {
    const defaultTools: TestTool[] = [{ name: 'terminal' }, { name: 'file_editor' }];
    const providedTools: TestTool[] = [{ name: 'glob' }];

    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: false,
      hasToolsOption: false,
      defaultTools,
      providedTools,
    });

    expect(tools.map((t) => t.name)).toEqual(['glob']);
  });

  it('includes all defaults when includeDefaultTools is true', () => {
    const defaultTools: TestTool[] = [{ name: 'terminal' }, { name: 'file_editor' }];
    const providedTools: TestTool[] = [{ name: 'glob' }];

    const tools = resolveToolsWithDefaultTools({
      includeDefaultTools: true,
      hasToolsOption: false,
      defaultTools,
      providedTools,
    });

    expect(tools.map((t) => t.name)).toEqual(['terminal', 'file_editor', 'glob']);
  });
});
