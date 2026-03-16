import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import type { AgentContext } from '../context';
import type { SecretRegistry } from '../runtime';
import type { AgentHook } from '../runtime/hooks';
import type { SecretStorage } from 'vscode';
import {
  isAgentServerWorkspace,
  type BaseWorkspace,
} from '../../workspace';
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
  /**
   * Base directory for OpenHands-Tab persisted images (used to resolve `openhands-image://...` references
   * into data URLs for multimodal LLM requests in local mode).
   */
  pastedImagesBaseDir?: string;
  hooks?: AgentHook | AgentHook[];
}

export function Conversation(options: ConversationFactoryOptions): ConversationInstance {
  if (options.workspace && isAgentServerWorkspace(options.workspace)) {
    return new RemoteConversation({
      settings: options.settings,
      workspace: options.workspace,
      conversationId: options.conversationId,
      tools: options.tools,
      includeDefaultTools: options.includeDefaultTools,
    }) as ConversationInstance;
  }
  if (options.serverUrl) {
    return new RemoteConversation({
      serverUrl: options.serverUrl,
      settings: options.settings,
      workspaceRoot: options.workspaceRoot,
      conversationId: options.conversationId,
      tools: options.tools,
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
    pastedImagesBaseDir: options.pastedImagesBaseDir,
    hooks: options.hooks,
  }) as ConversationInstance;
}

export { LocalConversation, RemoteConversation };
export * from './RemoteState';
export * from './ConversationVisualizer';
export * from './stuckDetector';
