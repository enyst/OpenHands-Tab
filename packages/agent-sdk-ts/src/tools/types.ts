import type { EventLog } from '../sdk/runtime/EventLog';
import type { SecretRegistry } from '../sdk/runtime/SecretRegistry';
import type { LocalWorkspace } from '../workspace/LocalWorkspace';

export interface ToolContext {
  workspace: LocalWorkspace;
  events?: EventLog;
  secrets?: SecretRegistry;
}

export interface ToolHandler<TArgs, TResult> {
  name: string;
  validate(input: unknown): TArgs;
  execute(args: TArgs, context: ToolContext): Promise<TResult>;
}
