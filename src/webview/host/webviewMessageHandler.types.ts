import type * as vscode from 'vscode';
import type { ConversationInstance, SecretRegistry } from '@smolpaws/agent-sdk';
import type { HostToWebviewMessage, WebviewE2EInfo } from '../../shared/webviewMessages';

export type WebviewHost = {
  postMessage: (message: HostToWebviewMessage) => Thenable<boolean>;
};

export type CreateWebviewMessageHandlerDeps = {
  context: vscode.ExtensionContext;
  host: WebviewHost;
  secretRegistry?: SecretRegistry;
  getQueuedUserEditNotes: () => string[];
  clearQueuedUserEditNotes: () => void;

  getConversation: () => ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
  getConversationStoreRoot: () => string | undefined;
  resolveConversationStoreRoot: () => Promise<string>;

  /**
   * Optional override for the LLM profile store root directory. Defaults to `~/.openhands/llm-profiles`.
   * Intended for tests only (no workspace overrides).
   */
  getLlmProfilesStoreRoot?: () => string | undefined;

  setWebviewReadyState: (conversationId?: string, lastSeenSeq?: number) => void;
  setWebviewE2EReady?: (ready: boolean) => void;
  setWebviewE2EInfo?: (info: WebviewE2EInfo | null) => void;
  setLastKnownLlmLabel: (label: string | null) => void;
  getLastKnownLlmLabel: () => string | null;

  flushConversationEventBacklog: (args: {
    postMessage: WebviewHost['postMessage'];
    clientConversationId?: string;
    clientLastSeenSeq?: number;
  }) => void;

  onRenderedEventsResponse: (
    requestId: string,
    info: {
      count: number;
      eventTypes: string[];
      events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
    }
  ) => void;
  onUiStateResponse: (
    requestId: string,
    info: {
      input: string;
      showContextPicker: boolean;
      showSkillsPopover: boolean;
      showHistory: boolean;
      showLlmProfiles: boolean;
      llmProfileId: string | null;
      llmProfiles: string[];
      workspaceFilesCount: number;
      selectedContextFiles: string[];
      skillsCount: number;
      attachmentsCount: number;
      hasWelcomeProviderKey: boolean;
      hasWelcomeGeminiKey: boolean;
      showWelcomeProviderKeyMessage: boolean;
      showWelcomeGeminiKeyMessage: boolean;
    }
  ) => void;
  onHalStateResponse: (
    requestId: string,
    info: {
      enabled: boolean;
      mode: string;
      phase: string;
      eye: string;
      stepIndex: number | null;
      decision: string | null;
      lastError: string | null;
    }
  ) => void;

  isDevBridgeEnabled: () => boolean;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  fileLog: (line: string) => void;
};
