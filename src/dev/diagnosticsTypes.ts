import type { OpenHandsSettings } from '../settings/SettingsManager';

export type TerminalLogInfo = {
  hasTerminal: boolean;
  received: number;
  ptyOpened?: boolean;
  preopenBufferedChars?: number;
  preopenDroppedChars?: number;
  lastEvents?: Array<{ type?: string; timestamp: number }>;
};

export type DiagnosticsInfo = {
  chat?: {
    hasView?: boolean;
    visible?: boolean;
    webviewReady?: boolean;
    clientConversationId?: string;
    clientLastSeenSeq?: number;
  };
  eventBacklog?: {
    activeConversationId?: string;
    size?: number;
    latestSeq?: number;
  };
  hasConversation?: boolean;
  conversationId?: string;
  status?: string;
  mode?: 'local' | 'remote';
  serverUrl?: string;
  servers?: OpenHandsSettings['servers'];
  terminal?: TerminalLogInfo;
};

