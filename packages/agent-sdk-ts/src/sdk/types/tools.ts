import type { EventLog } from '../runtime/EventLog';
import type { SecretRegistry } from '../runtime/SecretRegistry';
import type { LLMToolDefinition } from '../llm';
import type { LocalWorkspace } from '../../workspace/LocalWorkspace';

export interface ToolContext {
  workspace: LocalWorkspace;
  events?: EventLog;
  secrets?: SecretRegistry;
}

export interface ToolDefinition<TArgs, TResult> {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  validate(input: unknown): TArgs;
  execute(args: TArgs, context: ToolContext): Promise<TResult>;
  getToolDefinition?: () => LLMToolDefinition;
}
