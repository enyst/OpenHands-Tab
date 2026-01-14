import type { EventLog } from '../runtime/EventLog';
import type { SecretRegistry } from '../runtime/SecretRegistry';
import type { LLMToolDefinition } from '../llm';
import type { BaseWorkspace } from '../../workspace';
import type { OpenHandsSettings } from './settings';

export interface ToolContext {
  workspace: BaseWorkspace;
  events?: EventLog;
  secrets?: SecretRegistry;
  settings?: OpenHandsSettings;
}

export interface ToolDefinition<TArgs, TResult> {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  validate(input: unknown): TArgs;
  execute(args: TArgs, context: ToolContext): Promise<TResult>;
  getToolDefinition?: () => LLMToolDefinition;
  /**
   * Returns an enhanced description with context-specific information (e.g., working directory).
   * If not implemented, the static description is used.
   */
  getEnhancedDescription?: (workspaceRoot: string) => string;
}
