import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SettingsManager } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { type HalStateSnapshot, isHalMode, isHalDecision, isHalEye, isHalPhase } from './shared/halTypes';
import { DEFAULT_HAL_STATE } from './shared/halDefaults';
import { resolveConfiguredLlmLabel } from './shared/llmProfiles';
import { maskSecretsInText } from './shared/maskSecrets';
import { safeStringify } from './shared/safeStringify';
import { getGlobalStorageBaseDir } from './shared/pastedImages';
import { transformEventForWebview as transformEventForWebviewWithPastedImages } from './conversation/host/transformEventForWebview';
import { ConversationEventBacklog, type BufferedConversationEvent } from './conversation/eventBacklog';
import { OpenHandsTerminalLogPseudoterminal } from './terminal/OpenHandsTerminalLogPseudoterminal';
import { registerDiagnosticsCommands, type RenderedEventsInfo, type UiStateSnapshot } from './dev/registerDiagnosticsCommands';
import { registerHalCommands } from './hal/registerHalCommands';
import { STATUS_MESSAGE_DISMISS_DELAY_MS, type HostToWebviewMessage } from './shared/webviewMessages';
import { resolveLocalTools } from './shared/localTools';
import { createDevBridgeLogger, createMaskedOutputChannel } from './extension/devBridgeLogger';
import { createDebugJsonOutputChannel, type DebugJsonOutputChannel } from './extension/debugJsonOutputChannel';
import { createFileEditNoteTracker } from './extension/fileEditNote';
import { getGitHeadDiffSummaryForFile, resolveGitContext } from './extension/gitDiffSummary';
import { resolveConversationStoreRoot } from './extension/conversationStoreRoot';
import { registerExplainSelectionCommand } from './extension/explainSelectionCommand';
import { createPastedImagesCleanupScheduler } from './extension/pastedImagesCleanupScheduler';
import { registerSecretCommands } from './extension/secretCommands';
import { summarizeWithLocalLlm } from './extension/summarizeWithLocalLlm';
import { createHalConfigurationChangeHandler } from './extension/halConfigurationChangeHandler';
import { formatEnvironmentInformation } from './shared/environmentInformation';
import { resolvePreferredWorkspaceRoot } from './shared/workspaceRoot';
import {
  createOutputLogger,
  normalizeOutputVerbosity,
  type OutputLogger,
  type OutputVerbosity,
} from './extension/outputLogger';
import {
  AgentContext,
  Conversation,
  type ConversationInstance,
  SecretRegistry,
  listProfiles,
  loadSkillsFromDir,
  type Skill,
  type BashEvent,
  type Event,
  isBashCommand,
  isBashExit,
  isBashOutput,
} from '@openhands/agent-sdk-ts';
import { OpenHandsChatViewProvider } from './sidebar/OpenHandsChatViewProvider';
import { attachConversationListeners } from './conversation/host/attachConversationListeners';
import { createConfigurationChangeHandler } from './settings/host/createConfigurationChangeHandler';
import { createWebviewMessageHandler } from './webview/host/createWebviewMessageHandler';

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

function markPrintedExitFor(commandId: string): void {
  // LRU-ish: bump recency on re-add
  if (printedExitFor.has(commandId)) {
    printedExitFor.delete(commandId);
  }
  printedExitFor.set(commandId, true);

  if (printedExitFor.size <= MAX_PRINTED_EXIT_FOR) return;
  const oldest = printedExitFor.keys().next().value;
  if (oldest) printedExitFor.delete(oldest);
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

function resolveActiveEditorFilePath(editor: vscode.TextEditor | undefined): string | undefined {
  if (!editor) return undefined;
  const uri = editor.document.uri;
  if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') return undefined;
  const fsPath = typeof uri.fsPath === 'string' ? uri.fsPath.trim() : '';
  return fsPath || undefined;
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
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activeEditorPath =
      (vscode.window.activeTextEditor?.document?.uri?.scheme === 'file' || vscode.window.activeTextEditor?.document?.uri?.scheme === 'vscode-remote')
        ? vscode.window.activeTextEditor.document.uri.fsPath
        : null;
    const openEditorPaths = (vscode.window.visibleTextEditors ?? [])
      .map((e) => ((e?.document?.uri?.scheme === 'file' || e?.document?.uri?.scheme === 'vscode-remote') ? e.document.uri.fsPath : null))
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    return formatEnvironmentInformation({ workspaceRoot, activeEditorPath, openEditorPaths });
  } catch {
    return null;
  }
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

  let lastChatViewVisibility: boolean | undefined;

  const chatViewProvider = new OpenHandsChatViewProvider(context, {
    createMessageHandler: (view) =>
      createWebviewMessageHandler({
        context,
        host: { postMessage: (message) => view.webview.postMessage(message) },
        secretRegistry: secrets,
        getQueuedUserEditNotes: fileEditNoteTracker.getQueuedUserEditNotes,
        clearQueuedUserEditNotes: fileEditNoteTracker.clearQueuedUserEditNotes,
        getConversation: () => conversation,
        getConversationMode: () => conversationMode,
        getConversationStoreRoot: () => conversationStoreRoot,
        resolveConversationStoreRoot: () =>
          resolveConversationStoreRoot({ context, getOutputChannel: () => outputChannel, renderError }),
        setWebviewReadyState: (conversationId, lastSeenSeq) => {
          chatWebviewReady = true;
          chatLastConversationId = conversationId;
          chatLastSeenSeq = lastSeenSeq;
        },
        setLastKnownLlmLabel: (label) => {
          lastKnownLlmLabel = label;
        },
        getLastKnownLlmLabel: () => lastKnownLlmLabel,
        flushConversationEventBacklog,
        onRenderedEventsResponse: (requestId, info) => {
          pendingRenderedEventsRequests.get(requestId)?.(info);
        },
        onUiStateResponse: (requestId, info) => {
          pendingUiStateRequests.get(requestId)?.(info);
        },
        onHalStateResponse: (requestId, info) => {
          const mode = isHalMode(info.mode) ? info.mode : DEFAULT_HAL_STATE.mode;
          const phase = isHalPhase(info.phase) ? info.phase : DEFAULT_HAL_STATE.phase;
          const eye = isHalEye(info.eye) ? info.eye : DEFAULT_HAL_STATE.eye;
          const decision = isHalDecision(info.decision) ? info.decision : null;
          pendingHalStateRequests.get(requestId)?.({
            enabled: info.enabled === true,
            mode,
            phase,
            eye,
            stepIndex: typeof info.stepIndex === 'number' ? info.stepIndex : null,
            decision,
            lastError: typeof info.lastError === 'string' ? info.lastError : null,
          });
        },
        isDevBridgeEnabled: () => devBridgeLogger.isEnabled(),
        getOutputChannel: () => outputChannel,
        fileLog: devBridgeLogger.fileLog,
      }),
    onResolved: (view) => {
      chatView = view;
      chatWebviewReady = false;
      lastChatViewVisibility = Boolean(view.visible);
      void ensureConversationAndConnection({ uiJustCreated: true }).catch((err: unknown) => {
        outputChannel?.appendLine(`[error] ensureConversationAndConnection failed: ${renderError(err)}`);
      });
    },
    onVisibilityChange: (_view, visible) => {
      const isVisible = Boolean(visible);
      if (lastChatViewVisibility === isVisible) return;
      lastChatViewVisibility = isVisible;

      if (!isVisible) {
        void (async () => {
          try {
            await conversation?.pause();
          } catch (err) {
            outputChannel?.appendLine(`[pause] Failed to auto-pause when chat view was hidden: ${renderError(err)}`);
          }
        })();
      }
    },
    onDisposed: () => {
      const shouldPauseOnDispose = lastChatViewVisibility !== false;
      if (shouldPauseOnDispose) {
        void (async () => {
          try {
            await conversation?.pause();
          } catch (err) {
            outputChannel?.appendLine(`[pause] Failed to auto-pause when chat view was disposed: ${renderError(err)}`);
          }
        })();
      }
      chatView = undefined;
      chatWebviewReady = false;
      chatLastConversationId = undefined;
      chatLastSeenSeq = undefined;
      lastChatViewVisibility = undefined;
    },
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openhands.agent', chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
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
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(fileEditNoteTracker.onDidSaveTextDocument)
  );

  const handleTerminalEvent = (event: BashEvent) => {
    receivedTerminalEvents.push({ type: event.type, timestamp: Date.now() });
    if (receivedTerminalEvents.length > MAX_TERMINAL_EVENTS) {
      receivedTerminalEvents.shift();
    }

    if (chatView && chatWebviewReady && chatView.visible) {
      void chatView.webview.postMessage({ type: 'terminalEvent', event } satisfies HostToWebviewMessage);
    }

    if (conversationMode !== 'local') {
      return;
    }

    // Recreate terminal if not present or if the PTY has been closed
    if (!terminal || !terminalLogPty || terminalLogPty.isClosed?.()) {
      try {
        const renderProgress =
          vscode.workspace.getConfiguration().get<boolean>('openhands.terminal.renderProgress') ?? true;
        terminalLogPty = new OpenHandsTerminalLogPseudoterminal({ renderProgress });
        terminal = vscode.window.createTerminal({ name: 'OpenHands', pty: terminalLogPty });
      } catch (e) {
        console.error('[Terminal] Failed to create terminal log:', e);
        terminal = undefined;
        terminalLogPty = undefined;
        return;
      }
    }

    try {
      if (isBashCommand(event)) {
        // Add a spacer only if previous output didn't end with a newline
        terminalLogPty.ensureNewline?.();
        terminalLogPty.writeLine(`$ ${event.command}`);
        if (event.command_id) printedExitFor.delete(event.command_id);
      } else if (isBashOutput(event)) {
        if (event.stdout) terminalLogPty.write(event.stdout);
        if (event.stderr) terminalLogPty.write(event.stderr);
        // Defensive: if exit_code is provided on output but no BashExit arrives, synthesize a footer once
        const cid = 'command_id' in event ? (event as { command_id?: string }).command_id : undefined;
        const code = 'exit_code' in event ? (event as { exit_code?: number }).exit_code : undefined;
        if (cid && typeof code === 'number' && !printedExitFor.has(cid)) {
          terminalLogPty.ensureNewline?.();
          terminalLogPty.writeLine(`[Process exited with code ${code}]`);
          markPrintedExitFor(cid);
        }
      } else if (isBashExit(event)) {
        const cid = 'command_id' in event ? (event as { command_id?: string }).command_id : undefined;
        if (!cid || !printedExitFor.has(cid)) {
          terminalLogPty.ensureNewline?.();
          terminalLogPty.writeLine(`[Process exited with code ${event.exit_code}]`);
        }
        if (cid) {
          markPrintedExitFor(cid);
        }
      }
    } catch (err) {
      console.error(`[Terminal] Failed to write terminal event: ${renderError(err)}`);
    }
  };

  async function ensureConversationAndConnection(options?: { uiJustCreated?: boolean; modeSwitched?: boolean }) {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    let settings = await settingsMgr.get();
    lastKnownLlmLabel = resolveConfiguredLlmLabel(settings);

    const cfg = vscode.workspace.getConfiguration();
    outputVerbosity = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
    verboseEventLogging =
      outputVerbosity === 'verbose' ||
      Boolean(settings.agent?.debug) ||
      Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));

    if (!settings.serverUrl && settings.agent?.summarizeToolCalls === true) {
      const hasGeminiKey = await (async (): Promise<boolean> => {
        let storedGeminiKey: string | undefined;
        try {
          storedGeminiKey = await context.secrets.get('GEMINI_API_KEY');
        } catch {
          storedGeminiKey = undefined;
        }
        if (typeof storedGeminiKey === 'string' && storedGeminiKey.trim()) return true;
        if (typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim()) return true;

        // If the main agent LLM is configured to use Gemini, allow the generic LLM key as well.
        if (settings.llm.provider === 'gemini') {
          const mainKey = settings.secrets.llmApiKey;
          if (typeof mainKey === 'string' && mainKey.trim()) return true;
        }

        return false;
      })();

      if (!hasGeminiKey) {
        try {
          await settingsMgr.update({ agent: { ...settings.agent, summarizeToolCalls: false } });
          settings = await settingsMgr.get();
        } catch (err) {
          outputChannel?.appendLine(`[settings] Failed to auto-disable tool summarization: ${renderError(err)}`);
        }

        if (chatView) {
          void chatView.webview.postMessage({
            type: 'statusMessage',
            level: 'error',
            message: 'No Gemini key found, tool summarization disabled',
            autoDismiss: true,
            autoDismissDelay: STATUS_MESSAGE_DISMISS_DELAY_MS,
          } satisfies HostToWebviewMessage);
        }
      }
    }

    const workspaceRoot = resolvePreferredWorkspaceRoot();

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const savedIdKey = desiredMode === 'local' ? 'openhands.conversationId.local' : 'openhands.conversationId.remote';
    if (options?.modeSwitched) {
      // Switching modes should always start a fresh conversation, never restore prior state.
      resetConversationEventBacklog(undefined);
      printedExitFor.clear();
      await context.workspaceState.update(savedIdKey, undefined);
    }

    let savedId = (options?.uiJustCreated || options?.modeSwitched)
      ? undefined
      : context.workspaceState.get<string>(savedIdKey);

    if (savedId) {
      const looksLocal = savedId.startsWith('local-');
      const matchesDesiredMode = desiredMode === 'local' ? looksLocal : !looksLocal;
      if (!matchesDesiredMode) savedId = undefined;
    }
    const needsNewConversation = !conversation || conversationMode !== desiredMode;

    if (needsNewConversation) {
      try {
        conversation?.removeAllListeners();
        conversation?.disconnect();
      } catch {}
      fileEditNoteTracker.reset();

      const persistenceDir =
        desiredMode === 'local'
          ? await resolveConversationStoreRoot({ context, getOutputChannel: () => outputChannel, renderError }).catch((err: unknown) => {
              outputChannel?.appendLine(`[storage] Failed to resolve conversation store root: ${renderError(err)}`);
              return path.join(os.tmpdir(), 'openhands-conversations-vscode');
            })
          : undefined;
      conversationStoreRoot = persistenceDir;

      const agentContext = (() => {
        if (desiredMode !== 'local' || !workspaceRoot) return undefined;

        const skillsDir = path.join(workspaceRoot, '.openhands', 'skills');
        let skills: Skill[] = [];
        try {
          const { repoSkills, knowledgeSkills, agentSkills } = loadSkillsFromDir(skillsDir);
          skills = [...repoSkills.values(), ...knowledgeSkills.values(), ...agentSkills.values()];
        } catch (err) {
          outputChannel?.appendLine(`[skills] Failed to load project skills from ${skillsDir}: ${renderError(err)}`);
        }

        return new AgentContext({
          skills,
          loadUserSkills: true,
        });
      })();
      localAgentContext = desiredMode === 'local' ? agentContext : undefined;
      if (desiredMode === 'local') {
        syncActiveEditorSystemMessageSuffix(vscode.window.activeTextEditor);
      }

      const conversationOptions = {
        serverUrl: settings.serverUrl ?? undefined,
        settings,
        workspaceRoot,
        tools: settings.serverUrl ? undefined : resolveLocalTools(),
        secrets,
        persistenceDir,
        agentContext,
      };

      // Populate user environment info suffix for local mode (after agentContext is created & system message synced)
      if (desiredMode === 'local' && localAgentContext) {
        const env = buildEnvironmentInfoSuffix();
        localAgentContext.userMessageSuffix = env ?? undefined;
      }

      try {
        conversation = Conversation(conversationOptions);
      } catch (err) {
        outputChannel?.appendLine(`[error] Failed to create Conversation: ${renderError(err)}`);
        // Keep extension alive even if persistence path is broken; fall back to temp.
        if (desiredMode === 'local' && persistenceDir) {
          const fallbackDir = path.join(os.tmpdir(), 'openhands-conversations-vscode');
          outputChannel?.appendLine(`[storage] Retrying Conversation with fallback dir: ${fallbackDir}`);
          conversationStoreRoot = fallbackDir;
          conversation = Conversation({ ...conversationOptions, persistenceDir: fallbackDir });
        } else {
          throw err;
        }
      }
      conversationMode = desiredMode;

      conversation.removeAllListeners();
      attachConversationListeners({
        context,
        conversation,
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

      if (savedId && conversation) {
        try {
          const maybe = conversation.restoreConversation(savedId);
          void Promise.resolve(maybe).catch((err: unknown) => {
            outputChannel?.appendLine(`[restoreConversation] ${renderError(err)}`);
          });
        } catch (err) {
          outputChannel?.appendLine(`[restoreConversation] ${renderError(err)}`);
        }
      }
    } else if (conversation) {
      conversation.setSettings(settings);
    } else {
      outputChannel?.appendLine('[warn] Conversation unavailable during settings refresh');
    }

    if (chatView && chatWebviewReady) {
      void chatView.webview.postMessage({
        type: 'status',
        status: conversation?.getStatus() ?? 'offline',
        mode: conversationMode,
        llmProfileLabel: lastKnownLlmLabel,
      } satisfies HostToWebviewMessage);

      try {
        void chatView.webview.postMessage({
          type: 'llmProfilesUpdated',
          profiles: listProfiles(),
          activeProfileId: settings.llm.profileId ?? null,
        } satisfies HostToWebviewMessage);
      } catch (err) {
        outputChannel?.appendLine(`[llm] Failed to list profiles for webview sync: ${renderError(err)}`);
      }
    }
  }

  const open = vscode.commands.registerCommand('openhands.open', async () => {
    try {
      // VS Code auto-creates a focus command for views: `<viewId>.focus`
      await vscode.commands.executeCommand('openhands.agent.focus');
    } catch {
      // Fallback: open the container and reveal the view if already resolved
      await vscode.commands.executeCommand('workbench.view.extension.openhands');
      chatView?.show?.(true);
    }
    await ensureConversationAndConnection();
  });

  const explainSelection = registerExplainSelectionCommand({
    getConversation: () => conversation,
    getConversationMode: () => conversationMode,
  });

  const diagnosticsCommands = registerDiagnosticsCommands({
    context,
    getChatView: () => chatView,
    getChatWebviewReady: () => chatWebviewReady,
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

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensureConversationAndConnection();
    sentTestEvents.length = 0;
    printedExitFor.clear();
    await conversation?.startNewConversation();
  });

  const configure = vscode.commands.registerCommand('openhands.configure', async () => {
    // Open VS Code settings page for OpenHands extension
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
  });

  const toggleVerboseOutput = vscode.commands.registerCommand('openhands.toggleVerboseOutput', async () => {
    const cfg = vscode.workspace.getConfiguration();
    const current = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
    const next: OutputVerbosity = current === 'verbose' ? 'minimal' : 'verbose';
    await cfg.update('openhands.logging.verbosity', next, vscode.ConfigurationTarget.Global);
    outputVerbosity = next;
    verboseEventLogging =
      outputVerbosity === 'verbose' ||
      Boolean(cfg.get<boolean>('openhands.agent.debug')) ||
      Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));
    outputLogger?.info(`[settings] Output verbosity set to ${next}`);
    if (next === 'verbose') {
      outputLogger?.show(true);
    }
    void vscode.window.showInformationMessage(`OpenHands output verbosity: ${next}`);
  });

  const secretCommands = registerSecretCommands({
    context,
    secrets,
    getConversation: () => conversation,
  });

  const reconnect = vscode.commands.registerCommand('openhands.reconnect', async () => {
    await ensureConversationAndConnection();
    conversation?.reconnect();
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

  const pause = vscode.commands.registerCommand('openhands.pauseCurrentRun', async () => {
    await ensureConversationAndConnection();
    await conversation?.pause();
  });

  const resume = vscode.commands.registerCommand('openhands.resumeCurrentRun', async () => {
    await ensureConversationAndConnection();
    await conversation?.resume();
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
    open,
    explainSelection,
    ...diagnosticsCommands,
    ...halCommands,
    startNew,
    configure,
    toggleVerboseOutput,
    ...secretCommands,
    reconnect,
    pause,
    resume
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
  chatLastConversationId = undefined;
  chatLastSeenSeq = undefined;
  conversationStoreRoot = undefined;
  resetConversationEventBacklog(undefined);
  receivedTerminalEvents.length = 0;
  sentTestEvents.length = 0;
  printedExitFor.clear();
}
