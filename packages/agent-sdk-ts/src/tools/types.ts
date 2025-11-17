import type { EventLog } from '../runtime/EventLog';
import type { LocalWorkspace } from '../workspace/LocalWorkspace';
import type { SecretRegistry } from '../runtime/SecretRegistry';

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
