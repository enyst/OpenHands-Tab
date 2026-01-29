export type DiagnosticsInfo = {
  chat?: {
    hasView?: boolean;
    visible?: boolean;
    webviewReady?: boolean;
    e2eReady?: boolean;
    e2eInfo?: {
      host: string;
      pathname: string;
      extensionId?: string;
      title?: string;
    } | null;
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
