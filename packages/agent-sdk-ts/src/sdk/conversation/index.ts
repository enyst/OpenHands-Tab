import type { OpenHandsSettings } from '../types/settings';
import { LocalConversation } from './LocalConversation';
import { RemoteConversation } from './RemoteConversation';

export type ConversationMode = 'local' | 'remote';

export type ConversationInstance = (LocalConversation | RemoteConversation) & { mode: ConversationMode };

export interface ConversationFactoryOptions {
  serverUrl?: string | null;
  settings: OpenHandsSettings;
  workspaceRoot?: string;
  conversationId?: string;
}

export function Conversation(options: ConversationFactoryOptions): ConversationInstance {
  if (options.serverUrl) {
    return new RemoteConversation({
      serverUrl: options.serverUrl,
      settings: options.settings,
      workspaceRoot: options.workspaceRoot,
      conversationId: options.conversationId,
    }) as ConversationInstance;
  }
  return new LocalConversation({
    settings: options.settings,
    conversationId: options.conversationId,
    workspaceRoot: options.workspaceRoot,
  }) as ConversationInstance;
}

export { LocalConversation, RemoteConversation };
