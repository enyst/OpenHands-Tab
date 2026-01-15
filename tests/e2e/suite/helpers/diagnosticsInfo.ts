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
  terminal?: {
    hasTerminal?: boolean;
    received?: number;
    ptyOpened?: boolean;
    preopenBufferedChars?: number;
    preopenDroppedChars?: number;
  };
  hasConversation?: boolean;
  conversationId?: string;
  status?: string;
  mode?: 'local' | 'remote';
  serverUrl?: string;
  servers?: Array<{ url: string; label?: string }>;
};

