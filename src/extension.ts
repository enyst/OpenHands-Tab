import * as vscode from 'vscode';
import { type HalStateSnapshot } from './shared/halTypes';
import { maskSecretsInText } from './shared/maskSecrets';
import { safeStringify } from './shared/safeStringify';
import { getGlobalStorageBaseDir } from './shared/pastedImages';
import { transformEventForWebview as transformEventForWebviewWithPastedImages } from './conversation/host/transformEventForWebview';
import { ConversationEventBacklog, type BufferedConversationEvent } from './conversation/eventBacklog';
import { OpenHandsTerminalLogPseudoterminal } from './terminal/OpenHandsTerminalLogPseudoterminal';
import { registerDiagnosticsCommands, type RenderedEventsInfo, type UiStateSnapshot } from './dev/registerDiagnosticsCommands';
import { registerHalCommands } from './hal/registerHalCommands';
import { type HostToWebviewMessage, type WebviewE2EInfo } from './shared/webviewMessages';
import { createDevBridgeLogger, createMaskedOutputChannel } from './extension/devBridgeLogger';
import { createDebugJsonOutputChannel, type DebugJsonOutputChannel } from './extension/debugJsonOutputChannel';
import { createFileEditNoteTracker } from './extension/fileEditNote';
import { getGitHeadDiffSummaryForFile, resolveGitContext } from './extension/gitDiffSummary';
import { registerExplainSelectionCommand } from './extension/explainSelectionCommand';
import { createPastedImagesCleanupScheduler } from './extension/pastedImagesCleanupScheduler';
import { createConversationLifecycleOrchestrator, type EnsureConversationOptions } from './extension/conversationLifecycle';
import { resolveConversationStoreRoot } from './extension/conversationStoreRoot';
import { registerSecretCommands } from './extension/secretCommands';
import { summarizeWithLocalLlm } from './extension/summarizeWithLocalLlm';
import { createHalConfigurationChangeHandler } from './extension/halConfigurationChangeHandler';
import { registerCoreCommands } from './extension/coreCommands';
import { registerWelcomeSecretStatusSync } from './extension/welcomeSecretStatusSync';
import { mirrorTerminalEventToLocalTerminal } from './extension/localTerminalMirror';
import { registerChatViewProvider } from './extension/chatViewProvider';
import { formatEnvironmentInformation } from './shared/environmentInformation';
import { collectEnvironmentInfo } from './shared/collectEnvironmentInfo';
import { getFileBackedFsPath } from './shared/uri';
import { registerCloudLoginCommand } from './extension/cloudLoginCommand';
import { registerCloudLogoutCommand } from './extension/cloudLogoutCommand';
import type { CloudBootstrapResult } from './cloud/cloudRemoteBootstrap';
import {
  createOutputLogger,
  normalizeOutputVerbosity,
  type OutputLogger,
  type OutputVerbosity,
} from './extension/outputLogger';
import {
  type AgentContext,
  type ConversationInstance,
  SecretRegistry,
  type BashEvent,
  type Event,
  isBashCommand,
  isBashOutput,
} from '@openhands/agent-sdk-ts';
import { attachConversationListeners } from './conversation/host/attachConversationListeners';
import { createConfigurationChangeHandler } from './settings/host/createConfigurationChangeHandler';

let chatView: vscode.WebviewView | undefined;
let conversation: ConversationInstance | undefined;
let conversationMode: 'local' | 'remote' = 'remote';
let terminal: vscode.Terminal | undefined;
let terminalLogPty: OpenHandsTerminalLogPseudoterminal | undefined;
let pastedImagesBaseDir = getGlobalStorageBaseDir(undefined);
const pendingRenderedEventsRequests = new Map<string, (info: RenderedEventsInfo) => void>();
const pendingUiStateRequests = new Map<string, (info: UiStateSnapshot) => void>();
const pendingHalStateRequests = new Map<string, (info: HalStateSnapshot) => void>();
let chatWebviewReady = false; // Track if chat WebviewView is ready
let chatWebviewE2EReady = false; // Track if chat webview sent E2E handshake
let chatWebviewE2EInfo: WebviewE2EInfo | null = null;
let chatLastConversationId: string | undefined;
let chatLastSeenSeq: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let outputLogger: OutputLogger | undefined;
let outputVerbosity: OutputVerbosity = 'minimal';
let debugJsonChannel: DebugJsonOutputChannel | undefined;
let secretRegistry: SecretRegistry | undefined;
let conversationStoreRoot: string | undefined;
let lastKnownLlmLabel: string | null = null;
let verboseEventLogging = false;
let localAgentContext: AgentContext | undefined;
let activeEditorFilePath: string | undefined;
let lastRemoteAuthPromptAtMs = 0;
let lastRemoteServerUrl: string | undefined;
let cloudRemoteBootstrap: CloudBootstrapResult | null = null;
const receivedTerminalEvents: { type?: string; timestamp: number }[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
const MAX_EVENT_BACKLOG = 2000;
// Pasted images are persisted under globalStorage/pasted-images; enforce a best-effort cap.
const MAX_PASTED_IMAGES_STORAGE_FILES = 2000;
const MAX_PASTED_IMAGES_STORAGE_BYTES = 200 * 1024 * 1024;
const eventBacklog = new ConversationEventBacklog({ maxSize: MAX_EVENT_BACKLOG });
const pastedImagesCleanupScheduler = createPastedImagesCleanupScheduler({
  iterBacklog: () => eventBacklog.iter(),
  getBaseDir: () => pastedImagesBaseDir,
  maxFiles: MAX_PASTED_IMAGES_STORAGE_FILES,
  maxBytes: MAX_PASTED_IMAGES_STORAGE_BYTES,
  log: (line) => outputLogger?.info(line),
  renderError,
});
// Buffer of test events sent via _sendTestEvent (used as fallback in E2E query)
const MAX_TEST_EVENTS = MAX_EVENT_BACKLOG;
const sentTestEvents: Event[] = [];
// Track which command_ids have already printed an exit summary to avoid duplicates
const MAX_PRINTED_EXIT_FOR = MAX_TERMINAL_EVENTS;

const printedExitFor = new Map<string, true>();

const pushWithLimit = <T>(buffer: T[], value: T, maxSize: number): void => {
  buffer.push(value);
  if (buffer.length > maxSize) {
    buffer.splice(0, buffer.length - maxSize);
  }
};

const setMapWithLimit = <K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void => {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
};

function markPrintedExitFor(commandId: string): void {
  // LRU-ish: bump recency on re-add
  setMapWithLimit(printedExitFor, commandId, true, MAX_PRINTED_EXIT_FOR);
}

function resetConversationEventBacklog(conversationId: string | undefined) {
  eventBacklog.reset(conversationId);
}

function bufferConversationEvent(event: Event): number {
  const seq = eventBacklog.push(event);
  pastedImagesCleanupScheduler.handleBufferedEvent(event);
  return seq;
}

function* iterConversationEventBacklog(): Iterable<BufferedConversationEvent> {
  yield* eventBacklog.iter();
}

function flushConversationEventBacklog(params: {
  postMessage: (message: HostToWebviewMessage) => Thenable<boolean>;
  clientConversationId?: string;
  clientLastSeenSeq?: number;
}) {
  const webview = chatView?.webview;
  const transformEvent = webview
    ? (event: Event) => transformEventForWebviewWithPastedImages(event, { webview, pastedImagesBaseDir })
    : undefined;

  eventBacklog.flushToClient({
    postMessage: params.postMessage,
    clientConversationId: params.clientConversationId,
    clientLastSeenSeq: params.clientLastSeenSeq,
    fallbackConversationId: conversation?.getConversationId(),
    transformEvent,
  });
}

/** Render an error for logging/display (handles Error objects and unknown values) */
function renderError(err: unknown): string {
  const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return maskSecretsInText(rendered, secretRegistry);
}

function maskTerminalEventForDisplay(event: BashEvent): BashEvent {
  if (!secretRegistry) return event;

  if (isBashCommand(event)) {
    const command = maskSecretsInText(event.command, secretRegistry);
    return command === event.command ? event : { ...event, command };
  }

  if (isBashOutput(event)) {
    const stdout = typeof event.stdout === 'string' ? maskSecretsInText(event.stdout, secretRegistry) : event.stdout;
    const stderr = typeof event.stderr === 'string' ? maskSecretsInText(event.stderr, secretRegistry) : event.stderr;
    if (stdout === event.stdout && stderr === event.stderr) return event;
    return { ...event, stdout, stderr };
  }

  return event;
}

function resolveActiveEditorFilePath(editor: vscode.TextEditor | undefined): string | undefined {
  return getFileBackedFsPath(editor?.document?.uri);
}

function syncActiveEditorSystemMessageSuffix(editor: vscode.TextEditor | undefined): void {
  activeEditorFilePath = resolveActiveEditorFilePath(editor);
  if (!localAgentContext) return;
  // Only populate systemMessageSuffix; environment context for user messages will be provided via userMessageSuffix when sending.
  localAgentContext.systemMessageSuffix = activeEditorFilePath
    ? `Currently opened in the editor: ${activeEditorFilePath}`
    : undefined;
}

/**
 * Initialize the OpenHands extension: create logging channel and chat webview, register commands and configuration handlers, and wire up terminal, conversation, and secret-management behavior.
 *
 * Performs extension startup work and registers disposables (commands, webview provider, event listeners, and configuration change handlers) on the provided VS Code extension context.
 */

function buildEnvironmentInfoSuffix(): string | null {
  try {
    return formatEnvironmentInformation(collectEnvironmentInfo());
  } catch {
    return null;
  }
}

function syncLocalUserMessageSuffix(): void {
  if (!localAgentContext) return;
  const env = buildEnvironmentInfoSuffix();
  localAgentContext.userMessageSuffix = env ?? undefined;
}

export function activate(context: vscode.ExtensionContext) {
  const secrets = new SecretRegistry(context.secrets);
  secretRegistry = secrets;

  const devBridgeLogger = createDevBridgeLogger({ secretRegistry: secrets });
  const cfg = vscode.workspace.getConfiguration();
  outputVerbosity = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
  verboseEventLogging =
    outputVerbosity === 'verbose' ||
    Boolean(cfg.get<boolean>('openhands.agent.debug')) ||
    Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));
  outputLogger = createOutputLogger({
    getOutputChannel: () => outputChannel,
    getExtensionMode: () => context.extensionMode,
    getVerbosity: () => (verboseEventLogging ? 'verbose' : 'minimal'),
  });

  try {
    const channel = vscode.window.createOutputChannel('OpenHands', { log: true });
    outputChannel = createMaskedOutputChannel(channel, secrets);
    context.subscriptions.push(channel);

    const extensionMode = vscode.ExtensionMode;
    const isProduction =
      extensionMode?.Production !== undefined ? context.extensionMode === extensionMode.Production : true;
    const shouldShowOnActivation =
      !isProduction ||
      outputVerbosity === 'verbose' ||
      Boolean(cfg.get<boolean>('openhands.agent.debug')) ||
      Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));

    if (shouldShowOnActivation) {
      outputLogger?.show(true);
    }
    outputLogger?.info('[OpenHands] Logging channel initialized');
  } catch (err) {
    console.warn('[OpenHands] Failed to create output channel:', err);
    outputChannel = undefined;
  }

  // Create debug JSON output channel (only in dev/test modes or with devBridge enabled)
  debugJsonChannel = createDebugJsonOutputChannel({ context, secretRegistry: secrets });
  if (debugJsonChannel.isEnabled()) {
    outputLogger?.info('[OpenHands-DEBUG] Debug JSON channel initialized');
  }

  pastedImagesBaseDir = getGlobalStorageBaseDir(context.globalStorageUri?.fsPath);

  const fileEditNoteTracker = createFileEditNoteTracker({
    getConversation: () => conversation,
    getOutputChannel: () => outputChannel,
    renderError,
    getGitHeadDiffSummaryForFile,
  });

  let ensureConversationAndConnectionDelegate = (_options?: EnsureConversationOptions): Promise<void> =>
    Promise.reject(new Error('Conversation lifecycle orchestrator not initialized'));
  async function ensureConversationAndConnection(options?: EnsureConversationOptions): Promise<void> {
    await ensureConversationAndConnectionDelegate(options);
  }

  context.subscriptions.push(
    registerChatViewProvider({
      context,
      secretRegistry: secrets,
      conversation: {
        getConversation: () => conversation,
        getConversationMode: () => conversationMode,
        getConversationStoreRoot: () => conversationStoreRoot,
        resolveConversationStoreRoot: () =>
          resolveConversationStoreRoot({ context, getOutputChannel: () => outputChannel, renderError }),
        ensureConversationAndConnection: (options) => ensureConversationAndConnection(options),
        pauseConversation: async () => {
          await conversation?.pause();
        },
      },
      state: {
        setChatView: (view) => {
          chatView = view;
        },
        setChatWebviewReady: (ready) => {
          chatWebviewReady = ready;
        },
        setChatWebviewE2EReady: (ready) => {
          chatWebviewE2EReady = ready;
        },
        setChatWebviewE2EInfo: (info) => {
          chatWebviewE2EInfo = info;
        },
        setChatLastConversationId: (conversationId) => {
          chatLastConversationId = conversationId;
        },
        setChatLastSeenSeq: (lastSeenSeq) => {
          chatLastSeenSeq = lastSeenSeq;
        },
        setLastKnownLlmLabel: (label) => {
          lastKnownLlmLabel = label;
        },
        getLastKnownLlmLabel: () => lastKnownLlmLabel,
      },
      messages: {
        getQueuedUserEditNotes: fileEditNoteTracker.getQueuedUserEditNotes,
        clearQueuedUserEditNotes: fileEditNoteTracker.clearQueuedUserEditNotes,
        flushConversationEventBacklog,
        onRenderedEventsResponse: (requestId, info) => {
          pendingRenderedEventsRequests.get(requestId)?.(info);
        },
        onUiStateResponse: (requestId, info) => {
          pendingUiStateRequests.get(requestId)?.(info);
        },
        onHalStateResponse: (requestId, info) => {
          pendingHalStateRequests.get(requestId)?.(info);
        },
      },
      logging: {
        isDevBridgeEnabled: () => devBridgeLogger.isEnabled(),
        getOutputChannel: () => outputChannel,
        fileLog: devBridgeLogger.fileLog,
        renderError,
      },
    })
  );

  context.subscriptions.push(
    registerWelcomeSecretStatusSync({
      context,
      getChatView: () => chatView,
      getOutputChannel: () => outputChannel,
      renderError,
    })
  );

  // Enable dev bridge only for Development/Test extension modes or with user setting
  const mode = context.extensionMode;
  const extensionMode = vscode.ExtensionMode;
  const isDevOrTest =
    (extensionMode?.Development !== undefined &&
      (mode === extensionMode.Development || mode === extensionMode.Test)) ||
    false;
  const enableFromSetting = !!vscode.workspace.getConfiguration().get<boolean>('openhands.devBridge.enabled');
  devBridgeLogger.setEnabled(isDevOrTest || enableFromSetting);
  void devBridgeLogger.initFileLogger(context);

  syncActiveEditorSystemMessageSuffix(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      syncActiveEditorSystemMessageSuffix(editor);
      syncLocalUserMessageSuffix();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(fileEditNoteTracker.onDidSaveTextDocument)
  );

  const handleTerminalEvent = (event: BashEvent) => {
    const displayEvent = maskTerminalEventForDisplay(event);
    pushWithLimit(receivedTerminalEvents, { type: event.type, timestamp: Date.now() }, MAX_TERMINAL_EVENTS);

    if (chatView && chatWebviewReady && chatView.visible) {
      void chatView.webview.postMessage({ type: 'terminalEvent', event: displayEvent } satisfies HostToWebviewMessage);
    }

    if (conversationMode !== 'local') {
      return;
    }

    const mirrored = mirrorTerminalEventToLocalTerminal({
      event: displayEvent,
      state: { terminal, terminalLogPty },
      createTerminal: () => {
        try {
          const renderProgress =
            vscode.workspace.getConfiguration().get<boolean>('openhands.terminal.renderProgress') ?? true;
          const nextTerminalLogPty = new OpenHandsTerminalLogPseudoterminal({ renderProgress });
          const nextTerminal = vscode.window.createTerminal({ name: 'OpenHands', pty: nextTerminalLogPty });
          return { terminal: nextTerminal, terminalLogPty: nextTerminalLogPty };
        } catch (e) {
          console.error('[Terminal] Failed to create terminal log:', e);
          return { terminal: undefined, terminalLogPty: undefined };
        }
      },
      hasPrintedExitFor: (commandId) => printedExitFor.has(commandId),
      clearPrintedExitFor: (commandId) => {
        printedExitFor.delete(commandId);
      },
      markPrintedExitFor,
      renderError,
    });
    terminal = mirrored.terminal;
    terminalLogPty = mirrored.terminalLogPty;
  };

  ensureConversationAndConnectionDelegate = createConversationLifecycleOrchestrator({
    context,
    secrets,
    renderError,
    getOutputChannel: () => outputChannel,
    setOutputVerbosity: (verbosity) => {
      outputVerbosity = verbosity;
    },
    setVerboseEventLogging: (verbose) => {
      verboseEventLogging = verbose;
    },
    hasChatView: () => Boolean(chatView),
    isChatWebviewReady: () => chatWebviewReady,
    postWebviewMessage: (message) => {
      if (!chatView) return;
      void chatView.webview.postMessage(message);
    },
    getConversation: () => conversation,
    setConversation: (next) => {
      conversation = next;
    },
    getConversationMode: () => conversationMode,
    setConversationMode: (mode) => {
      conversationMode = mode;
    },
    getPastedImagesBaseDir: () => pastedImagesBaseDir,
    setConversationStoreRoot: (root) => {
      conversationStoreRoot = root;
    },
    setLocalAgentContext: (next) => {
      localAgentContext = next;
    },
    getLastKnownLlmLabel: () => lastKnownLlmLabel,
    setLastKnownLlmLabel: (label) => {
      lastKnownLlmLabel = label;
    },
    getLastRemoteServerUrl: () => lastRemoteServerUrl,
    setLastRemoteServerUrl: (url) => {
      lastRemoteServerUrl = url;
    },
    getLastRemoteAuthPromptAtMs: () => lastRemoteAuthPromptAtMs,
    setLastRemoteAuthPromptAtMs: (value) => {
      lastRemoteAuthPromptAtMs = value;
    },
    getCloudRemoteBootstrap: () => cloudRemoteBootstrap,
    setCloudRemoteBootstrap: (bootstrap) => {
      cloudRemoteBootstrap = bootstrap;
    },
    resetFileEditNoteTracker: () => {
      fileEditNoteTracker.reset();
    },
    resetConversationEventBacklog,
    clearPrintedExitFor: () => {
      printedExitFor.clear();
    },
    syncActiveEditorSystemMessageSuffix,
    syncLocalUserMessageSuffix,
    getActiveTextEditor: () => vscode.window.activeTextEditor,
    attachConversationListeners: (conversationInstance) => {
      conversationInstance.removeAllListeners();
      attachConversationListeners({
        context,
        conversation: conversationInstance,
        log: {
          info: (line) => outputLogger?.info(line),
          warn: (line) => outputLogger?.warn(line),
          error: (line) => outputLogger?.error(line),
        },
        getDebugJsonChannel: () => debugJsonChannel,
        getChatView: () => chatView,
        isChatWebviewReady: () => chatWebviewReady,
        getConversationMode: () => conversationMode,
        getLastKnownLlmLabel: () => lastKnownLlmLabel,
        isVerboseEventLogging: () => verboseEventLogging,
        bufferConversationEvent,
        resetConversationEventBacklog,
        trackAgentEditedFile: fileEditNoteTracker.trackAgentEditedFile,
        resetAgentEditedFiles: fileEditNoteTracker.reset,
        transformEventForWebview: (event, webview) => transformEventForWebviewWithPastedImages(event, { webview, pastedImagesBaseDir }),
        safeStringify,
        renderError,
        handleTerminalEvent,
      });
    },
  }).ensureConversationAndConnection;

  const explainSelection = registerExplainSelectionCommand({
    getConversation: () => conversation,
    getConversationMode: () => conversationMode,
  });

  const cloudLogin = registerCloudLoginCommand({
    context,
    getOutputChannel: () => outputChannel,
  });
  const cloudLogout = registerCloudLogoutCommand({
    context,
    getOutputChannel: () => outputChannel,
  });

  const diagnosticsCommands = registerDiagnosticsCommands({
    context,
    getChatView: () => chatView,
    getChatWebviewReady: () => chatWebviewReady,
    getChatWebviewE2EReady: () => chatWebviewE2EReady,
    getChatWebviewE2EInfo: () => chatWebviewE2EInfo,
    getChatLastConversationId: () => chatLastConversationId,
    getChatLastSeenSeq: () => chatLastSeenSeq,
    eventBacklog,
    iterConversationEventBacklog,
    bufferConversationEvent,
    sentTestEvents,
    maxTestEvents: MAX_TEST_EVENTS,
    pendingRenderedEventsRequests,
    pendingUiStateRequests,
    pendingHalStateRequests,
    ensureConversationAndConnection: (options) => ensureConversationAndConnection(options),
    secretRegistry: secrets,
    trackAgentEditedFile: fileEditNoteTracker.trackAgentEditedFile,
    getConversation: () => conversation,
    getConversationMode: () => conversationMode,
    getTerminal: () => terminal,
    getTerminalLogPty: () => terminalLogPty,
    getReceivedTerminalEventsCount: () => receivedTerminalEvents.length,
    getRecentTerminalEvents: (max = 10) => receivedTerminalEvents.slice(-Math.max(0, Math.min(max, MAX_TERMINAL_EVENTS))),
    onTerminalEvent: (event) => handleTerminalEvent(event),
    getOutputChannel: () => outputChannel,
    renderError,
  });

  const halCommands = registerHalCommands({
    context,
    getChatView: () => chatView,
    getChatWebviewReady: () => chatWebviewReady,
    iterConversationEventBacklog,
    sentTestEvents,
    ensureConversationAndConnection: (options) => ensureConversationAndConnection(options),
    printedExitFor,
    secretRegistry: secrets,
    getConversation: () => conversation,
    getOutputChannel: () => outputChannel,
    renderError,
    resolveGitContext,
    summarizeWithLocalLlm,
  });

  const secretCommands = registerSecretCommands({
    context,
    secrets,
    getConversation: () => conversation,
  });

  // Clear terminal references when the user closes the OpenHands terminal
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        terminal = undefined;
        terminalLogPty = undefined;
      }
    })
  );

  const coreCommands = registerCoreCommands({
    openCommand: async () => {
      try {
        // VS Code auto-creates a focus command for views: `<viewId>.focus`
        await vscode.commands.executeCommand('openhands.agent.focus');
      } catch {
        // Fallback: open the container and reveal the view if already resolved
        await vscode.commands.executeCommand('workbench.view.extension.openhands');
        chatView?.show?.(true);
      }
      await ensureConversationAndConnection();
    },
    startNewConversation: async () => {
      await ensureConversationAndConnection();
      sentTestEvents.length = 0;
      printedExitFor.clear();
      await conversation?.startNewConversation();
    },
    reconnectConversation: async () => {
      await ensureConversationAndConnection();
      conversation?.reconnect();
    },
    pauseConversation: async () => {
      await ensureConversationAndConnection();
      await conversation?.pause();
    },
    resumeConversation: async () => {
      await ensureConversationAndConnection();
      await conversation?.resume();
    },
    setOutputVerbosity: (verbosity) => {
      outputVerbosity = verbosity;
    },
    setVerboseEventLogging: (verbose) => {
      verboseEventLogging = verbose;
    },
    getOutputLogger: () => outputLogger,
  });

  // Listen for runtime configuration changes
  const onConfigurationChangeBase = createConfigurationChangeHandler({
    ensureConversationAndConnection: (options) => ensureConversationAndConnection(options),
    getConversation: () => conversation,
    setConversation: (next) => {
      conversation = next;
    },
    getConversationMode: () => conversationMode,
    getTerminal: () => terminal,
    setTerminal: (next) => {
      terminal = next;
    },
    getTerminalLogPty: () => terminalLogPty,
    setTerminalLogPty: (pty) => {
      terminalLogPty = pty as OpenHandsTerminalLogPseudoterminal | undefined;
    },
    setConversationStoreRoot: (root) => {
      conversationStoreRoot = root;
    },
    setOutputVerbosity: (value) => {
      outputVerbosity = value;
    },
    setVerboseEventLogging: (value) => {
      verboseEventLogging = value;
    },
    log: {
      info: (line) => outputLogger?.info(line),
      warn: (line) => outputLogger?.warn(line),
      error: (line) => outputLogger?.error(line),
    },
    renderError,
  });
  const onHalConfigurationChange = createHalConfigurationChangeHandler({
    context,
    getChatView: () => chatView,
    isChatWebviewReady: () => chatWebviewReady,
    getOutputChannel: () => outputChannel,
    renderError,
  });
  const onConfigurationChange = async (e: vscode.ConfigurationChangeEvent) => {
    await onConfigurationChangeBase(e);
    await onHalConfigurationChange(e);
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange));

  context.subscriptions.push(
    ...coreCommands,
    explainSelection,
    cloudLogin,
    cloudLogout,
    ...diagnosticsCommands,
    ...halCommands,
    ...secretCommands,
  );
}

export function deactivate() {
  try { conversation?.disconnect(); } catch { }
  try { terminal?.dispose(); } catch { }
  try { debugJsonChannel?.dispose(); } catch { }
  try { outputChannel?.dispose(); } catch { }
  // Reset module state to ensure clean slate for tests and re-activation
  chatView = undefined;
  conversation = undefined;
  terminal = undefined;
  terminalLogPty = undefined;
  debugJsonChannel = undefined;
  outputChannel = undefined;
  outputLogger = undefined;
  outputVerbosity = 'minimal';
  verboseEventLogging = false;
  localAgentContext = undefined;
  activeEditorFilePath = undefined;
  secretRegistry = undefined;
  lastKnownLlmLabel = null;
  pendingRenderedEventsRequests.clear();
  pendingUiStateRequests.clear();
  pendingHalStateRequests.clear();
  chatWebviewReady = false;
  chatWebviewE2EReady = false;
  chatWebviewE2EInfo = null;
  chatLastConversationId = undefined;
  chatLastSeenSeq = undefined;
  conversationStoreRoot = undefined;
  lastRemoteAuthPromptAtMs = 0;
  lastRemoteServerUrl = undefined;
  cloudRemoteBootstrap = null;
  resetConversationEventBacklog(undefined);
  receivedTerminalEvents.length = 0;
  sentTestEvents.length = 0;
  printedExitFor.clear();
}
