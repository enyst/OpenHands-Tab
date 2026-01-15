import { z } from 'zod';
import { Agent, ConversationState, EventLog } from '../../sdk/runtime';
import type { Message } from '../../sdk/types';
import { isTextContent } from '../../sdk/types';
import type { ToolContext } from '../types';
import { ZodTool } from '../zod-tool';
import { FileEditorTool } from '../FileEditorTool';
import { TaskTrackerTool } from '../TaskTrackerTool';
import { TerminalTool } from '../TerminalTool';
import { getAgentFactory, getFactoryInfo } from './registration';
import type { OpenHandsSettings } from '../../sdk/types/settings';
import type { DelegateAgentFactorySpec } from './registration';

export type DelegateCommand = 'spawn' | 'delegate';

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
    agent_types: z
      .array(z.string())
      .optional()
      .describe(
        "Optional for `spawn`. List of agent types for each ID (e.g. ['researcher', 'programmer']). Blank entries fall back to default.",
      ),
    tasks: z
      .record(z.string())
      .optional()
      .describe('Required for `delegate`. Dictionary mapping identifiers to task descriptions.'),
  })
  .superRefine((value, ctx) => {
    if (value.command === 'spawn' && (!value.ids || value.ids.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ids is required when command is "spawn"', path: ['ids'] });
    }
    if (value.command === 'spawn' && value.agent_types && value.ids && value.agent_types.length > value.ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `agent_types length (${value.agent_types.length}) cannot exceed ids length (${value.ids.length})`,
        path: ['agent_types'],
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

export interface DelegateObservation {
  command: DelegateCommand;
  ok: boolean;
  text: string;
  error?: string;
  spawned?: Array<{ id: string; agent_type: string }>;
  results?: Record<string, string>;
  errors?: Record<string, string>;
}

export type DelegateAction = z.infer<typeof delegateSchema>;

const TOOL_DESCRIPTION = `Delegation tool for spawning sub-agents and delegating tasks to them.

This tool provides two commands:

**spawn**: Initialize sub-agents with meaningful identifiers and optional types
- Use descriptive identifiers that make sense for your use case (e.g., 'refactoring', 'run_tests', 'research')
- Optionally specify agent types for specialized capabilities
- Each identifier creates a separate sub-agent conversation
- Examples:
  - Default agents: {"command": "spawn", "ids": ["research", "implementation"]}
  - Specialized agents: {"command": "spawn", "ids": ["research", "code"], "agent_types": ["researcher", "programmer"]}
  - Mixed types: {"command": "spawn", "ids": ["research", "generic"], "agent_types": ["researcher"]}  # unspecified entries fall back to the default agent

**delegate**: Send tasks to specific sub-agents and wait for results
- Use a dictionary mapping sub-agent identifiers to task descriptions
- This is a blocking operation - waits for all sub-agents to complete
- Returns a single observation containing results from all sub-agents
- Example: {"command": "delegate", "tasks": {"research": "Find best practices for async code", "implementation": "Refactor the MyClass class"}}

**Important Notes:**
- Identifiers used in delegate must match those used in spawn
- All operations are blocking and return comprehensive results
- Sub-agents work in the same workspace as the main agent`;

type SpawnedSubAgent = {
  id: string;
  agentType: string;
  runTask: (task: string) => Promise<string | undefined>;
};

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

const formatAgentLabel = (agentId: string, agentType: string): string => {
  const suffix = agentType === 'default' ? ' (default)' : ` (${agentType})`;
  return `${agentId}${suffix}`;
};

const messageToText = (message: Message | undefined): string | undefined => {
  if (!message) return undefined;
  const content = message.content ?? [];
  const parts: string[] = [];
  for (const item of content) {
    if (isTextContent(item)) {
      parts.push(item.text);
    } else {
      parts.push('[image]');
    }
  }
  const joined = parts.join('\n').trim();
  return joined ? joined : undefined;
};

export class DelegateTool extends ZodTool<DelegateAction, DelegateObservation> {
  readonly name = 'delegate';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = delegateSchema;

  private readonly maxChildren: number;
  private readonly subAgents: Map<string, SpawnedSubAgent> = new Map();

  constructor(options?: { maxChildren?: number }) {
    super();
    this.maxChildren = typeof options?.maxChildren === 'number' && Number.isFinite(options.maxChildren)
      ? Math.trunc(options.maxChildren)
      : 5;
  }

  getEnhancedDescription(workspaceRoot: string): string {
    const agentInfo = getFactoryInfo();
    return `${TOOL_DESCRIPTION}\n\n${agentInfo}\n\nWorkspace: ${workspaceRoot}`;
  }

  async execute(args: DelegateAction, context: ToolContext): Promise<DelegateObservation> {
    if (!context.settings) {
      return {
        command: args.command,
        ok: false,
        text: 'DelegateTool requires settings in ToolContext',
        error: 'missing_settings',
      };
    }

    if (args.command === 'spawn') {
      return this.spawnAgents(args, { ...context, settings: context.settings });
    }
    return this.delegateTasks(args, context);
  }

  private resolveAgentType(action: DelegateAction, index: number): string {
    const types = action.agent_types;
    if (!types || index >= types.length) return 'default';
    return toOptionalNonEmptyString(types[index]) ?? 'default';
  }

  private spawnAgents(action: DelegateAction, context: ToolContext & { settings: OpenHandsSettings }): DelegateObservation {
    const ids = action.ids ?? [];
    if (!ids.length) {
      return { command: 'spawn', ok: false, text: 'At least one ID is required for spawn action', error: 'missing_ids' };
    }

    if (this.subAgents.size + ids.length > this.maxChildren) {
      return {
        command: 'spawn',
        ok: false,
        text: `Cannot spawn ${ids.length} agents. Already have ${this.subAgents.size} agents, maximum is ${this.maxChildren}`,
        error: 'max_children_exceeded',
      };
    }

    const created: Map<string, SpawnedSubAgent> = new Map();
    const spawned: Array<{ id: string; agent_type: string }> = [];
    const labels: string[] = [];

    for (let i = 0; i < ids.length; i += 1) {
      const agentId = toOptionalNonEmptyString(ids[i]);
      if (!agentId) continue;
      const agentType = this.resolveAgentType(action, i);
      try {
        const factory = getAgentFactory(agentType);
        const spec = factory.factoryFunc({
          id: agentId,
          settings: context.settings,
          workspace: context.workspace,
          secrets: context.secrets,
        });
        const subAgent = this.createSubAgent({
          id: agentId,
          agentType,
          spec,
          workspace: context.workspace,
          secrets: context.secrets,
          settings: context.settings,
        });

        created.set(agentId, subAgent);
        spawned.push({ id: agentId, agent_type: agentType });
        labels.push(formatAgentLabel(agentId, agentType));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { command: 'spawn', ok: false, text: `failed to spawn agents: ${message}`, error: 'spawn_failed' };
      }
    }

    for (const [id, agent] of created) {
      this.subAgents.set(id, agent);
    }

    return {
      command: 'spawn',
      ok: true,
      spawned,
      text: `Successfully spawned ${spawned.length} sub-agents: ${labels.join(', ')}`,
    };
  }

  private async delegateTasks(action: DelegateAction, _context: ToolContext): Promise<DelegateObservation> {
    const tasks = action.tasks ?? {};
    const taskIds = Object.keys(tasks);
    if (!taskIds.length) {
      return { command: 'delegate', ok: false, text: 'At least one task is required for delegate action', error: 'missing_tasks' };
    }

    const missing = taskIds.filter((id) => !this.subAgents.has(id));
    if (missing.length) {
      const available = Array.from(this.subAgents.keys());
      return {
        command: 'delegate',
        ok: false,
        text: `sub-agents not found: ${missing.join(', ')}. Available agents: ${available.join(', ')}`,
        error: 'missing_agents',
      };
    }

    const results: Record<string, string> = {};
    const errors: Record<string, string> = {};

    const orderedEntries = taskIds.map((id) => [id, tasks[id]] as const);

    await Promise.allSettled(
      orderedEntries.map(async ([agentId, task]) => {
        const subAgent = this.subAgents.get(agentId)!;
        try {
          const response = await subAgent.runTask(task);
          results[agentId] = response ?? 'No response from sub-agent';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors[agentId] = `Sub-agent ${agentId} failed: ${message}`;
        }
      }),
    );

    const lines: string[] = [];
    for (const [agentId] of orderedEntries) {
      if (agentId in errors) {
        lines.push(`Agent ${agentId} ERROR: ${errors[agentId]}`);
      } else {
        lines.push(`Agent ${agentId}: ${results[agentId] ?? 'No result'}`);
      }
    }

    const errorCount = Object.keys(errors).length;
    const header = errorCount
      ? `Completed delegation of ${orderedEntries.length} tasks with ${errorCount} errors`
      : `Completed delegation of ${orderedEntries.length} tasks`;
    const text = lines.length ? `${header}\n\nResults:\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}` : header;

    return {
      command: 'delegate',
      ok: true,
      results,
      errors: errorCount ? errors : undefined,
      text,
    };
  }

  protected createSubAgent(args: {
    id: string;
    agentType: string;
    settings: OpenHandsSettings;
    workspace: ToolContext['workspace'];
    secrets: ToolContext['secrets'];
    spec: DelegateAgentFactorySpec;
  }): SpawnedSubAgent {
    const defaultTools = [new TerminalTool(), new FileEditorTool(), new TaskTrackerTool()];
    const providedTools = Array.isArray(args.spec.tools) ? args.spec.tools : defaultTools;
    const events = new EventLog();
    const state = new ConversationState({ eventLog: events });

    const agent = new Agent({
      settings: args.settings,
      workspace: args.workspace,
      tools: providedTools,
      includeDefaultTools: args.spec.includeDefaultTools,
      events,
      state,
      secrets: args.secrets,
      agentContext: args.spec.agentContext,
      hooks: args.spec.hooks,
    });

    const runTask = async (task: string): Promise<string | undefined> => {
      const message = await agent.run(task);
      return messageToText(message);
    };

    return { id: args.id, agentType: args.agentType, runTask };
  }
}

export default DelegateTool;
