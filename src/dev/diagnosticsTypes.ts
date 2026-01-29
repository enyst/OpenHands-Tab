import type { OpenHandsSettings } from '../settings/SettingsManager';
import type { WebviewE2EInfo } from '../shared/webviewMessages';

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
    e2eReady?: boolean;
    e2eInfo?: WebviewE2EInfo | null;
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

export type LastUserMessageInfo = {
  seq: number;
  contentTextPreview: string;
  extendedContentTextPreview: string;
  extendedContentCount: number;
} | null;
