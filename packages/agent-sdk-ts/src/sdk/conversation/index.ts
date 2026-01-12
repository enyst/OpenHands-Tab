import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import type { AgentContext } from '../context';
import type { SecretRegistry } from '../runtime';
import type { AgentHook } from '../runtime/hooks';
import type { SecretStorage } from 'vscode';
import type { BaseWorkspace } from '../../workspace';
import { LocalConversation } from './LocalConversation';
import { RemoteConversation } from './RemoteConversation';

export type ConversationMode = 'local' | 'remote';

export type ConversationInstance = (LocalConversation | RemoteConversation) & { mode: ConversationMode };

export interface ConversationFactoryOptions {
  serverUrl?: string | null;
  settings: OpenHandsSettings;
  workspace?: BaseWorkspace;
  workspaceRoot?: string;
  conversationId?: string;
  tools?: ToolDefinition<unknown, unknown>[];
  includeDefaultTools?: boolean | string[];
  secrets?: SecretRegistry;
  secretStorage?: SecretStorage;
  persistenceDir?: string;
  agentContext?: AgentContext;
  hooks?: AgentHook | AgentHook[];
}

export function Conversation(options: ConversationFactoryOptions): ConversationInstance {
  if (options.serverUrl) {
    return new RemoteConversation({
      serverUrl: options.serverUrl,
      settings: options.settings,
      workspaceRoot: options.workspaceRoot,
      conversationId: options.conversationId,
      includeDefaultTools: options.includeDefaultTools,
    }) as ConversationInstance;
  }
  return new LocalConversation({
    settings: options.settings,
    conversationId: options.conversationId,
    workspace: options.workspace,
    workspaceRoot: options.workspaceRoot,
    tools: options.tools,
    includeDefaultTools: options.includeDefaultTools,
    secrets: options.secrets,
    secretStorage: options.secretStorage,
    persistenceDir: options.persistenceDir,
    agentContext: options.agentContext,
    hooks: options.hooks,
  }) as ConversationInstance;
}

export { LocalConversation, RemoteConversation };
export * from './RemoteState';
export * from './ConversationVisualizer';
export * from './stuckDetector';
