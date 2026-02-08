import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalWorkspace } from '../../../workspace';
import type { OpenHandsSettings } from '../../../sdk/types/settings';
import { DelegateTool } from '../DelegateTool';
import { _resetRegistryForTests, registerAgent } from '../registration';

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 5 },
  confirmation: {},
  secrets: {},
};

class TestDelegateTool extends DelegateTool {
  protected createSubAgent(args: any) {
    return {
      id: args.id,
      agentType: args.agentType,
      runTask: async (task: string) => `${args.id} ran: ${task}`,
    };
  }
}

describe('DelegateTool', () => {
  beforeEach(() => _resetRegistryForTests());
  afterEach(() => _resetRegistryForTests());

  it('validates spawn/delegate schemas', () => {
    const tool = new DelegateTool();
    expect(() => tool.validate({ command: 'spawn' })).toThrow();
    expect(() => tool.validate({ command: 'delegate', tasks: {} })).toThrow();
    expect(() => tool.validate({ command: 'spawn', ids: ['a'], agent_types: ['x', 'y'] })).toThrow(/agent_types length/);
  });

  it('spawns agents with optional agent_types', async () => {
    registerAgent({ name: 'researcher', factoryFunc: () => ({}), description: 'Test researcher agent' });
    const tool = new TestDelegateTool();
    const workspace = new LocalWorkspace(process.cwd());

    const args = tool.validate({ command: 'spawn', ids: ['agent1', 'agent2'], agent_types: ['researcher'] });
    const result = await tool.execute(args, { workspace, settings: baseSettings });
    expect(result.ok).toBe(true);
    expect(result.spawned).toEqual([
      { id: 'agent1', agent_type: 'researcher' },
      { id: 'agent2', agent_type: 'default' },
    ]);
  });

  it('errors when delegating to missing agents', async () => {
    const tool = new TestDelegateTool();
    const workspace = new LocalWorkspace(process.cwd());

    const args = tool.validate({ command: 'delegate', tasks: { missing: 'do work' } });
    const result = await tool.execute(args, { workspace, settings: baseSettings });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_agents');
  });

  it('delegates tasks in parallel and aggregates results', async () => {
    const tool = new TestDelegateTool();
    const workspace = new LocalWorkspace(process.cwd());

    await tool.execute(tool.validate({ command: 'spawn', ids: ['a', 'b'] }), { workspace, settings: baseSettings });

    const result = await tool.execute(tool.validate({ command: 'delegate', tasks: { a: 'task a', b: 'task b' } }), {
      workspace,
      settings: baseSettings,
    });

    expect(result.ok).toBe(true);
    expect(result.results).toEqual({ a: 'a ran: task a', b: 'b ran: task b' });
    expect(result.text).toContain('Completed delegation of 2 tasks');
    expect(result.text).toContain('1. Agent a: a ran: task a');
    expect(result.text).toContain('2. Agent b: b ran: task b');
  });

  it('returns partial failures without aborting all tasks', async () => {
    class PartialFailTool extends TestDelegateTool {
      protected createSubAgent(args: any) {
        if (args.id === 'b') {
          return { id: args.id, agentType: args.agentType, runTask: async () => { throw new Error('boom'); } };
        }
        return super.createSubAgent(args);
      }
    }

    const tool = new PartialFailTool();
    const workspace = new LocalWorkspace(process.cwd());

    await tool.execute(tool.validate({ command: 'spawn', ids: ['a', 'b'] }), { workspace, settings: baseSettings });
    const result = await tool.execute(tool.validate({ command: 'delegate', tasks: { a: 'task a', b: 'task b' } }), {
      workspace,
      settings: baseSettings,
    });

    expect(result.ok).toBe(true);
    expect(result.results?.a).toBe('a ran: task a');
    expect(result.errors?.b).toContain('Sub-agent b failed: boom');
    expect(result.text).toContain('with 1 errors');
  });

  it('enforces max children', async () => {
    const tool = new TestDelegateTool({ maxChildren: 1 });
    const workspace = new LocalWorkspace(process.cwd());
    const result = await tool.execute(tool.validate({ command: 'spawn', ids: ['a', 'b'] }), { workspace, settings: baseSettings });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('max_children_exceeded');
  });
});
