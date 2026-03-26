import * as vscode from 'vscode';
import { type ConversationInstance, type SecretRegistry } from '@smolpaws/agent-sdk';
import { DEFAULT_HAL_STATE } from '../shared/halDefaults';
import { type HalStateSnapshot, isHalDecision, isHalEye, isHalMode, isHalPhase } from '../shared/halTypes';
import type { HostToWebviewMessage, WebviewE2EInfo } from '../shared/webviewMessages';
import { OpenHandsChatViewProvider } from '../sidebar/OpenHandsChatViewProvider';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';
import type { EnsureConversationOptions } from './conversationLifecycle';

type RenderedEventsInfo = {
  count: number;
  eventTypes: string[];
  events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
};

type UiStateSnapshot = {
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
};

type RegisterChatViewProviderDeps = {
  context: vscode.ExtensionContext;
  secretRegistry: SecretRegistry;
  conversation: {
    getConversation: () => ConversationInstance | undefined;
    getConversationMode: () => 'local' | 'remote';
    getConversationStoreRoot: () => string | undefined;
    resolveConversationStoreRoot: () => Promise<string>;
    ensureConversationAndConnection: (options?: EnsureConversationOptions) => Promise<void>;
    pauseConversation: () => Promise<void>;
  };
  state: {
    setChatView: (view: vscode.WebviewView | undefined) => void;
    setChatWebviewReady: (ready: boolean) => void;
    setChatWebviewE2EReady: (ready: boolean) => void;
    setChatWebviewE2EInfo: (info: WebviewE2EInfo | null) => void;
    setChatLastConversationId: (conversationId: string | undefined) => void;
    setChatLastSeenSeq: (lastSeenSeq: number | undefined) => void;
    setLastKnownLlmLabel: (label: string | null) => void;
    getLastKnownLlmLabel: () => string | null;
  };
  messages: {
    getQueuedUserEditNotes: () => string[];
    clearQueuedUserEditNotes: () => void;
    flushConversationEventBacklog: (args: {
      postMessage: (message: HostToWebviewMessage) => Thenable<boolean>;
      clientConversationId?: string;
      clientLastSeenSeq?: number;
    }) => void;
    onRenderedEventsResponse: (requestId: string, info: RenderedEventsInfo) => void;
    onUiStateResponse: (requestId: string, info: UiStateSnapshot) => void;
    onHalStateResponse: (requestId: string, info: HalStateSnapshot) => void;
  };
  logging: {
    isDevBridgeEnabled: () => boolean;
    getOutputChannel: () => vscode.OutputChannel | undefined;
    fileLog: (line: string) => void;
    renderError: (err: unknown) => string;
  };
};

export function registerChatViewProvider(deps: RegisterChatViewProviderDeps): vscode.Disposable {
  let lastChatViewVisibility: boolean | undefined;

  const chatViewProvider = new OpenHandsChatViewProvider(deps.context, {
    createMessageHandler: (view) =>
      createWebviewMessageHandler({
        context: deps.context,
        host: { postMessage: (message) => view.webview.postMessage(message) },
        secretRegistry: deps.secretRegistry,
        getQueuedUserEditNotes: deps.messages.getQueuedUserEditNotes,
        clearQueuedUserEditNotes: deps.messages.clearQueuedUserEditNotes,
        getConversation: deps.conversation.getConversation,
        getConversationMode: deps.conversation.getConversationMode,
        getConversationStoreRoot: deps.conversation.getConversationStoreRoot,
        resolveConversationStoreRoot: deps.conversation.resolveConversationStoreRoot,
        getLlmProfilesStoreRoot:
          deps.context.extensionMode !== vscode.ExtensionMode.Production && typeof process.env.E2E_LLM_PROFILES_DIR === 'string'
            ? () => process.env.E2E_LLM_PROFILES_DIR
            : undefined,
        setWebviewReadyState: (conversationId, lastSeenSeq) => {
          deps.state.setChatWebviewReady(true);
          deps.state.setChatLastConversationId(conversationId);
          deps.state.setChatLastSeenSeq(lastSeenSeq);
        },
        setWebviewE2EReady: deps.state.setChatWebviewE2EReady,
        setWebviewE2EInfo: deps.state.setChatWebviewE2EInfo,
        setLastKnownLlmLabel: deps.state.setLastKnownLlmLabel,
        getLastKnownLlmLabel: deps.state.getLastKnownLlmLabel,
        flushConversationEventBacklog: deps.messages.flushConversationEventBacklog,
        onRenderedEventsResponse: deps.messages.onRenderedEventsResponse,
        onUiStateResponse: deps.messages.onUiStateResponse,
        onHalStateResponse: (requestId, info) => {
          const mode = isHalMode(info.mode) ? info.mode : DEFAULT_HAL_STATE.mode;
          const phase = isHalPhase(info.phase) ? info.phase : DEFAULT_HAL_STATE.phase;
          const eye = isHalEye(info.eye) ? info.eye : DEFAULT_HAL_STATE.eye;
          const decision = isHalDecision(info.decision) ? info.decision : null;
          deps.messages.onHalStateResponse(requestId, {
            enabled: info.enabled === true,
            mode,
            phase,
            eye,
            stepIndex: typeof info.stepIndex === 'number' ? info.stepIndex : null,
            decision,
            lastError: typeof info.lastError === 'string' ? info.lastError : null,
          });
        },
        isDevBridgeEnabled: deps.logging.isDevBridgeEnabled,
        getOutputChannel: deps.logging.getOutputChannel,
        fileLog: deps.logging.fileLog,
      }),
    onResolved: (view) => {
      deps.state.setChatView(view);
      deps.state.setChatWebviewReady(false);
      deps.state.setChatWebviewE2EReady(false);
      deps.state.setChatWebviewE2EInfo(null);
      lastChatViewVisibility = Boolean(view.visible);

      void deps.conversation.ensureConversationAndConnection({ uiJustCreated: true }).catch((err: unknown) => {
        deps.logging.getOutputChannel()?.appendLine(
          `[error] ensureConversationAndConnection failed: ${deps.logging.renderError(err)}`
        );
      });
    },
    onVisibilityChange: (_view, visible) => {
      const isVisible = Boolean(visible);
      if (lastChatViewVisibility === isVisible) return;
      lastChatViewVisibility = isVisible;

      if (!isVisible) {
        void deps.conversation.pauseConversation().catch((err) => {
          deps.logging.getOutputChannel()?.appendLine(
            `[pause] Failed to auto-pause when chat view was hidden: ${deps.logging.renderError(err)}`
          );
        });
      }
    },
    onDisposed: () => {
      const shouldPauseOnDispose = lastChatViewVisibility !== false;
      if (shouldPauseOnDispose) {
        void deps.conversation.pauseConversation().catch((err) => {
          deps.logging.getOutputChannel()?.appendLine(
            `[pause] Failed to auto-pause when chat view was disposed: ${deps.logging.renderError(err)}`
          );
        });
      }

      deps.state.setChatView(undefined);
      deps.state.setChatWebviewReady(false);
      deps.state.setChatWebviewE2EReady(false);
      deps.state.setChatWebviewE2EInfo(null);
      deps.state.setChatLastConversationId(undefined);
      deps.state.setChatLastSeenSeq(undefined);
      lastChatViewVisibility = undefined;
    },
  });

  return vscode.window.registerWebviewViewProvider('openhands.agent', chatViewProvider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
}
