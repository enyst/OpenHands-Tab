import { describe, expect, it } from 'vitest';
import { ThinkTool } from '../ThinkTool';
import { LocalWorkspace } from '../../workspace';

describe('ThinkTool', () => {
  it('validates thought and returns a logged message', async () => {
    const tool = new ThinkTool();
    expect(() => tool.validate({})).toThrow();

    const args = tool.validate({ thought: 'Consider edge cases' });
    const result = await tool.execute(args, { workspace: new LocalWorkspace(process.cwd()) });
    expect(result.message).toBe('Your thought has been logged.');
  });

  it('rejects invalid thought edge cases', () => {
    const tool = new ThinkTool();
    expect(() => tool.validate({ thought: '' })).toThrow();
    expect(() => tool.validate({ thought: 123 } as any)).toThrow();
  });
});

