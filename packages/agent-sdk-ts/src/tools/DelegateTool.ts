import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export type DelegateCommand = 'spawn' | 'delegate';

export interface DelegateResult {
  command: DelegateCommand;
  detail: Record<string, unknown>;
}

const delegateSchema = z
  .object({
    command: z
      .union([z.literal('spawn'), z.literal('delegate')])
      .describe('The commands to run. Allowed options are: `spawn`, `delegate`.'),
    ids: z
      .array(z.string())
      .nonempty()
      .optional()
      .describe('Required for `spawn`. List of identifiers to initialize sub-agents with.'),
    tasks: z
      .record(z.string())
      .optional()
      .describe('Required for `delegate`. Dictionary mapping identifiers to task descriptions.'),
  })
  .superRefine((value, ctx) => {
    if (value.command === 'spawn' && (!value.ids || value.ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ids is required when command is "spawn"',
        path: ['ids'],
      });
    }
    if (value.command === 'delegate' && (!value.tasks || !Object.keys(value.tasks).length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tasks is required when command is "delegate"',
        path: ['tasks'],
      });
    }
  });

const TOOL_DESCRIPTION = `Delegation tool for spawning sub-agents and delegating tasks to them.

This tool provides two commands:

**spawn**: Initialize sub-agents with meaningful identifiers
- Use descriptive identifiers that make sense for your use case (e.g., 'refactoring', 'run_tests', 'research')
- Each identifier creates a separate sub-agent conversation
- Example: {"command": "spawn", "ids": ["research", "implementation", "testing"]}

**delegate**: Send tasks to specific sub-agents and wait for results
- Use a dictionary mapping sub-agent identifiers to task descriptions
- This is a blocking operation - waits for all sub-agents to complete
- Returns a single observation containing results from all sub-agents
- Example: {"command": "delegate", "tasks": {"research": "Find best practices for async code", "implementation": "Refactor the MyClass class"}}

**Important Notes:**
- Identifiers used in delegate must match those used in spawn
- All operations are blocking and return comprehensive results
- Sub-agents work in the same workspace as the main agent`;

export class DelegateTool extends ZodTool<z.infer<typeof delegateSchema>, DelegateResult> {
  readonly name = 'delegate';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = delegateSchema;

  execute(args: z.infer<typeof delegateSchema>, _context: ToolContext): Promise<DelegateResult> {
    if (args.command === 'spawn') {
      return Promise.resolve({ command: 'spawn', detail: { spawned: args.ids ?? [] } });
    }

    return Promise.resolve({ command: 'delegate', detail: { tasks: args.tasks ?? {} } });
  }
}

