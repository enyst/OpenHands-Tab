import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { SettingsManager, type OpenHandsSettings } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { type HalStateSnapshot, isElevenLabsMode, isHalDecision, isHalEye, isHalPhase } from './shared/halTypes';
import { DEFAULT_HAL_STATE } from './shared/halDefaults';
import { resolveConfiguredLlmLabel } from './shared/llmProfiles';
import { safeStringify } from './shared/safeStringify';
import { OPENHANDS_IMAGE_URL_PREFIX, getGlobalStorageBaseDir, isValidPastedImageId } from './shared/pastedImages';
import { cleanupPastedImages } from './shared/pastedImagesCleanup';
import { transformEventForWebview as transformEventForWebviewWithPastedImages } from './conversation/host/transformEventForWebview';
import { ConversationEventBacklog, type BufferedConversationEvent } from './conversation/eventBacklog';
import { OpenHandsTerminalLogPseudoterminal } from './terminal/OpenHandsTerminalLogPseudoterminal';
import { registerDiagnosticsCommands, type RenderedEventsInfo, type UiStateSnapshot } from './dev/registerDiagnosticsCommands';
import type { HostToWebviewMessage } from './shared/webviewMessages';
import {
  AgentContext,
  Conversation,
  type ConversationInstance,
  FileEditorTool,
  LLMFactory,
  SecretRegistry,
  TaskTrackerTool,
  TerminalTool,
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
let conversationStoreRoot: string | undefined;
let lastKnownLlmLabel: string | null = null;
let verboseEventLogging = false;
const receivedTerminalEvents: { type?: string; timestamp: number }[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
const MAX_EVENT_BACKLOG = 2000;
// Pasted images are persisted under globalStorage/pasted-images; enforce a best-effort cap.
const MAX_PASTED_IMAGES_STORAGE_FILES = 2000;
const MAX_PASTED_IMAGES_STORAGE_BYTES = 200 * 1024 * 1024;
const eventBacklog = new ConversationEventBacklog({ maxSize: MAX_EVENT_BACKLOG });
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

// Dev logging/instrumentation toggle and file sink
let devBridgeEnabled = false;
let webviewLogFile: string | undefined;
async function initFileLogger(context: vscode.ExtensionContext) {
  try {
    const logDir = context.logUri.fsPath;
    await fs.mkdir(logDir, { recursive: true });
    webviewLogFile = path.join(logDir, 'openhands-webview.log');
  } catch (_err) {
    webviewLogFile = undefined;
  }
}
function fileLog(line: string) {
  if (!devBridgeEnabled || !webviewLogFile) return;
  const ts = new Date().toISOString();
  fs.appendFile(webviewLogFile, `[${ts}] ${line}\n`).catch((err: unknown) => {
    console.warn('[OpenHands] Failed to append to webview log', err);
  });
}

let pastedImagesCleanupInFlight: Promise<void> | undefined;
let pastedImagesCleanupQueued = false;
const OPENHANDS_IMAGE_ID_REGEX = new RegExp(`${OPENHANDS_IMAGE_URL_PREFIX}([a-f0-9]{16}\\.[a-z0-9]+)`, 'g');

function messageHasPastedImages(event: Event): boolean {
  if (event.kind !== 'MessageEvent') return false;
  const content = (event as unknown as { llm_message?: { content?: unknown } }).llm_message?.content;
  if (!Array.isArray(content)) return false;
  for (const item of content) {
    if (!item || (item as { type?: unknown }).type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text === 'string' && text.includes(OPENHANDS_IMAGE_URL_PREFIX)) return true;
  }
  return false;
}

function collectReferencedPastedImageIdsFromBacklog(): Set<string> {
  const imageIds = new Set<string>();
  for (const item of eventBacklog.iter()) {
    const event = item.event;
    if (event.kind !== 'MessageEvent') continue;
    const content = (event as unknown as { llm_message?: { content?: unknown } }).llm_message?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || (part as { type?: unknown }).type !== 'text') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text !== 'string' || !text.includes(OPENHANDS_IMAGE_URL_PREFIX)) continue;

      for (const match of text.matchAll(OPENHANDS_IMAGE_ID_REGEX)) {
        const imageId = match[1];
        if (typeof imageId === 'string' && isValidPastedImageId(imageId)) {
          imageIds.add(imageId);
        }
      }
    }
  }
  return imageIds;
}

function schedulePastedImagesCleanup(): void {
  if (pastedImagesCleanupInFlight) {
    pastedImagesCleanupQueued = true;
    return;
  }

  pastedImagesCleanupInFlight = (async () => {
    try {
      const keepImageIds = collectReferencedPastedImageIdsFromBacklog();
      await cleanupPastedImages({
        baseDir: pastedImagesBaseDir,
        keepImageIds,
        maxFiles: MAX_PASTED_IMAGES_STORAGE_FILES,
        maxBytes: MAX_PASTED_IMAGES_STORAGE_BYTES,
        log: (line) => outputChannel?.appendLine(line),
      });
    } catch (err) {
      outputChannel?.appendLine(`[pasted-images] Cleanup failed: ${renderError(err)}`);
    } finally {
      pastedImagesCleanupInFlight = undefined;
    }
  })()
    .finally(() => {
      if (pastedImagesCleanupQueued) {
        pastedImagesCleanupQueued = false;
        schedulePastedImagesCleanup();
      }
    });
}

function resetConversationEventBacklog(conversationId: string | undefined) {
  eventBacklog.reset(conversationId);
}

function bufferConversationEvent(event: Event): number {
  const seq = eventBacklog.push(event);
  if (messageHasPastedImages(event)) {
    schedulePastedImagesCleanup();
  }
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

const createDefaultLocalTools = () => [
  new TerminalTool(),
  new FileEditorTool(),
  new TaskTrackerTool(),
];

/** Render an error for logging/display (handles Error objects and unknown values) */
function renderError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function execFileText(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : err.message;
        reject(new Error(message));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

async function resolveGitContext(workspaceRoot: string | undefined): Promise<{ repoName: string; branchName: string }> {
  const fallbackRepo = workspaceRoot ? path.basename(workspaceRoot) : 'unknown';
  if (!workspaceRoot) return { repoName: fallbackRepo, branchName: 'unknown' };

  try {
    const root = (await execFileText('git', ['rev-parse', '--show-toplevel'], workspaceRoot)).trim();
    const branch = (await execFileText('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root)).trim();
    return { repoName: path.basename(root) || fallbackRepo, branchName: branch || 'unknown' };
  } catch {
    return { repoName: fallbackRepo, branchName: 'unknown' };
  }
}

async function summarizeWithLocalLlm(settings: OpenHandsSettings, prompt: string, secrets: SecretRegistry): Promise<string> {
  const model = normalizeNonEmptyString(settings.llm.model) ?? '';
  if (!model) {
    throw new Error('LLM model is not configured');
  }
  const apiKey = normalizeNonEmptyString(settings.secrets.llmApiKey);

  const factory = new LLMFactory({
    provider: settings.llm.provider ?? undefined,
    model,
    baseUrl: normalizeNonEmptyString(settings.llm.baseUrl),
    apiKey: apiKey ?? undefined,
    apiVersion: normalizeNonEmptyString(settings.llm.apiVersion),
    timeoutSeconds: settings.llm.timeout ?? undefined,
    temperature: settings.llm.temperature ?? undefined,
    topP: settings.llm.topP ?? undefined,
    topK: settings.llm.topK ?? undefined,
    maxInputTokens: settings.llm.maxInputTokens ?? undefined,
    maxOutputTokens: settings.llm.maxOutputTokens ?? undefined,
    reasoningEffort: settings.llm.reasoningEffort ?? undefined,
    inputCostPerToken: settings.llm.inputCostPerToken ?? undefined,
    outputCostPerToken: settings.llm.outputCostPerToken ?? undefined,
  }, { secrets });

  const client = await factory.createClient();
  const request = {
    systemPrompt: '',
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
      },
    ],
  };

  let text = '';
  for await (const chunk of client.streamChat(request)) {
    if (chunk.type === 'text') text += chunk.text;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('LLM returned an empty summary');
  }
  return trimmed;
}

function normalizeNonEmptyString(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function resolveConfiguredPath(p: string): string {
  const raw = p.trim();
  if (raw.startsWith('~/') || raw === '~') {
    const suffix = raw === '~' ? '' : raw.slice(2);
    return path.join(os.homedir(), suffix);
  }
  if (raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) return raw;
  // Prefer homedir-relative resolution so behavior is stable even with no workspace open.
  return path.resolve(os.homedir(), raw);
}

async function ensureWritableDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.openhands-write-probe-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, 'ok', 'utf8');
  await fs.unlink(probe);
}

async function resolveConversationStoreRoot(context: vscode.ExtensionContext): Promise<string> {
  const cfg = vscode.workspace.getConfiguration();
  const configured = normalizeNonEmptyString(cfg.get<string>('openhands.conversation.storeRoot'));

  const candidates: Array<{ label: string; dir: string }> = [];
  if (configured) candidates.push({ label: 'setting openhands.conversation.storeRoot', dir: resolveConfiguredPath(configured) });

  try {
    candidates.push({ label: 'default ~/.openhands/conversations-vscode', dir: path.join(os.homedir(), '.openhands', 'conversations-vscode') });
  } catch (err) {
    outputChannel?.appendLine(`[storage] Failed to compute home dir default: ${renderError(err)}`);
  }

  const globalStorage = (context as unknown as { globalStorageUri?: vscode.Uri }).globalStorageUri?.fsPath;
  if (globalStorage) {
    candidates.push({ label: 'VS Code globalStorageUri', dir: path.join(globalStorage, 'conversations') });
  }

  candidates.push({ label: 'os.tmpdir()', dir: path.join(os.tmpdir(), 'openhands-conversations-vscode') });

  for (const candidate of candidates) {
    try {
      await ensureWritableDirectory(candidate.dir);
      if (candidate.dir !== candidates[0]?.dir) {
        outputChannel?.appendLine(`[storage] Using conversation store root: ${candidate.dir} (${candidate.label})`);
      }
      return candidate.dir;
    } catch (err) {
      outputChannel?.appendLine(`[storage] Cannot use ${candidate.label} (${candidate.dir}): ${renderError(err)}`);
    }
  }

  // Last resort: return tmp path even if we couldn't probe it; conversation may still run without persistence.
  return path.join(os.tmpdir(), 'openhands-conversations-vscode');
}

/**
 * Initialize the OpenHands extension: create logging channel and chat webview, register commands and configuration handlers, and wire up terminal, conversation, and secret-management behavior.
 *
 * Performs extension startup work and registers disposables (commands, webview provider, event listeners, and configuration change handlers) on the provided VS Code extension context.
 *
 * @param context - The VS Code extension context used to register disposables, access workspace and global state, and resolve extension resources
 */
export function activate(context: vscode.ExtensionContext) {
  try {
    const channel = vscode.window.createOutputChannel('OpenHands', { log: true });
    outputChannel = channel;
    context.subscriptions.push(channel);
    channel.show(true);
    channel.appendLine('[OpenHands] Logging channel initialized');
  } catch (err) {
    console.warn('[OpenHands] Failed to create output channel:', err);
    outputChannel = undefined;
  }

  const secretRegistry = new SecretRegistry(context.secrets);
  pastedImagesBaseDir = getGlobalStorageBaseDir(context.globalStorageUri?.fsPath);

  const chatViewProvider = new OpenHandsChatViewProvider(context, {
    createMessageHandler: (view) =>
      createWebviewMessageHandler({
        context,
        host: { postMessage: (message) => view.webview.postMessage(message) },
        getConversation: () => conversation,
        getConversationMode: () => conversationMode,
        getConversationStoreRoot: () => conversationStoreRoot,
        resolveConversationStoreRoot: () => resolveConversationStoreRoot(context),
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
          const mode = isElevenLabsMode(info.mode) ? info.mode : DEFAULT_HAL_STATE.mode;
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
        isDevBridgeEnabled: () => devBridgeEnabled,
        getOutputChannel: () => outputChannel,
        fileLog,
      }),
    onResolved: (view) => {
      chatView = view;
      chatWebviewReady = false;
      void ensureConversationAndConnection({ uiJustCreated: true }).catch((err: unknown) => {
        outputChannel?.appendLine(`[error] ensureConversationAndConnection failed: ${renderError(err)}`);
      });
    },
    onDisposed: () => {
      chatView = undefined;
      chatWebviewReady = false;
      chatLastConversationId = undefined;
      chatLastSeenSeq = undefined;
    },
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openhands.chat', chatViewProvider, {
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
  devBridgeEnabled = isDevOrTest || enableFromSetting;
  void initFileLogger(context);

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
        terminal.show(true);
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
    } catch (e) {
      console.error('[Terminal] Failed to write terminal event:', e);
    }
  };

  async function ensureConversationAndConnection(options?: { uiJustCreated?: boolean; modeSwitched?: boolean }) {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();
    lastKnownLlmLabel = resolveConfiguredLlmLabel(settings);

    const cfg = vscode.workspace.getConfiguration();
    verboseEventLogging = Boolean(settings.agent?.debug) || Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = workspaceRoot;

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

      const persistenceDir =
        desiredMode === 'local'
          ? await resolveConversationStoreRoot(context).catch((err: unknown) => {
              outputChannel?.appendLine(`[storage] Failed to resolve conversation store root: ${renderError(err)}`);
              return path.join(os.tmpdir(), 'openhands-conversations-vscode');
            })
          : undefined;
      conversationStoreRoot = persistenceDir;

      const agentContext =
        desiredMode === 'local'
          ? new AgentContext({ loadUserSkills: true })
          : undefined;

      const conversationOptions = {
        serverUrl: settings.serverUrl ?? undefined,
        settings,
        workspaceRoot,
        tools: settings.serverUrl ? undefined : createDefaultLocalTools(),
        secrets: secretRegistry,
        persistenceDir,
        agentContext,
      };

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
        getOutputChannel: () => outputChannel,
        getChatView: () => chatView,
        isChatWebviewReady: () => chatWebviewReady,
        getConversationMode: () => conversationMode,
        getLastKnownLlmLabel: () => lastKnownLlmLabel,
        isVerboseEventLogging: () => verboseEventLogging,
        bufferConversationEvent,
        resetConversationEventBacklog,
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

    if (chatView && chatWebviewReady && chatView.visible) {
      void chatView.webview.postMessage({
        type: 'status',
        status: conversation?.getStatus() ?? 'offline',
        mode: conversationMode,
        llmProfileLabel: lastKnownLlmLabel,
        llmModel: lastKnownLlmLabel,
      } satisfies HostToWebviewMessage);
    }
  }

  const open = vscode.commands.registerCommand('openhands.open', async () => {
    try {
      // VS Code auto-creates a focus command for views: `<viewId>.focus`
      await vscode.commands.executeCommand('openhands.chat.focus');
    } catch {
      // Fallback: open the container and reveal the view if already resolved
      await vscode.commands.executeCommand('workbench.view.extension.openhands');
      chatView?.show?.(true);
    }
    await ensureConversationAndConnection();
  });

  const explainSelection = vscode.commands.registerCommand('openhands.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showErrorMessage('OpenHands: No active editor to explain.');
      return;
    }

    const selection = editor.selection;
    if (!selection || selection.isEmpty) {
      void vscode.window.showErrorMessage('OpenHands: Select code to explain first.');
      return;
    }

    const selectedText = editor.document.getText(selection);
    if (!selectedText.trim()) {
      void vscode.window.showErrorMessage('OpenHands: Selection is empty.');
      return;
    }

    const maxChars = 12_000;
    const truncated =
      selectedText.length > maxChars
        ? `${selectedText.slice(0, maxChars)}\n\n[Truncated ${selectedText.length - maxChars} characters.]`
        : selectedText;

    const languageId = editor.document.languageId;
    const filePath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : editor.document.uri.toString();
    const start = selection.start;
    const end = selection.end;
    const range = `${filePath}:${start.line + 1}:${start.character + 1}-${end.line + 1}:${end.character + 1}`;

    const maxBackticks = Math.max(0, ...Array.from(truncated.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(Math.max(3, maxBackticks + 1));
    const fencedCode = `${fence}${languageId}\n${truncated}\n${fence}`;

    const prompt = [
      'Please explain this code:',
      '',
      `File: ${range}`,
      `Language: ${languageId}`,
      '',
      fencedCode,
    ].join('\n');

    await vscode.commands.executeCommand('openhands.open');
    await vscode.commands.executeCommand('openhands.startNewConversation');
    if (!conversation) {
      void vscode.window.showErrorMessage('OpenHands: Conversation is not available.');
      return;
    }
    await conversation.sendUserMessage(prompt);
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
    printedExitFor,
    secretRegistry,
    getConversation: () => conversation,
    getConversationMode: () => conversationMode,
    getTerminal: () => terminal,
    getReceivedTerminalEventsCount: () => receivedTerminalEvents.length,
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

  type SecretKey = keyof OpenHandsSettings['secrets'];
  const registerSecretCommand = (
    commandId: string,
    options: {
      title: string;
      secretKey: SecretKey;
      prompt: string;
      placeHolder?: string;
      successMessage: string;
      clearedMessage: string;
      errorPrefix: string;
    }
  ) =>
    vscode.commands.registerCommand(commandId, async () => {
      try {
        const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
        const existing = await settingsMgr.get();
        const currentValue = existing.secrets[options.secretKey];
        const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

        if (isCurrentlySet) {
          const action = await vscode.window.showQuickPick(
            [
              { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
              { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
            ],
            {
              title: options.title,
              placeHolder: 'Choose an action',
              canPickMany: false,
            }
          );
          if (!action) return;

          if (action.value === 'clear') {
            const confirmed = await vscode.window.showWarningMessage(
              `Clear ${options.title}?`,
              { modal: true },
              'Clear'
            );
            if (confirmed !== 'Clear') return;

            const secretsUpdate = { [options.secretKey]: undefined } as Partial<OpenHandsSettings['secrets']>;
            await settingsMgr.update({ secrets: secretsUpdate });
            vscode.window.showInformationMessage(options.clearedMessage);

            const newSettings = await settingsMgr.get();
            conversation?.setSettings(newSettings);
            return;
          }
        }

        const value = await vscode.window.showInputBox({
          title: options.title,
          password: true,
          prompt: options.prompt,
          placeHolder: options.placeHolder,
        });

        if (value === undefined) return;

        const trimmed = value.trim();
        if (!trimmed) return;

        const secretsUpdate = { [options.secretKey]: trimmed } as Partial<OpenHandsSettings['secrets']>;
        await settingsMgr.update({ secrets: secretsUpdate });
        vscode.window.showInformationMessage(options.successMessage);

        const newSettings = await settingsMgr.get();
        conversation?.setSettings(newSettings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${options.errorPrefix}: ${message}`);
      }
    });

  const registerSecretStorageCommand = (
    commandId: string,
    options: {
      title: string;
      storageKey: string;
      prompt: string;
      placeHolder?: string;
      successMessage: string;
      clearedMessage: string;
      errorPrefix: string;
    }
  ) =>
    vscode.commands.registerCommand(commandId, async () => {
      try {
        const currentValue = await context.secrets.get(options.storageKey);
        const isCurrentlySet = typeof currentValue === 'string' && currentValue.trim().length > 0;

        if (isCurrentlySet) {
          const action = await vscode.window.showQuickPick(
            [
              { label: 'Update', value: 'update', description: 'Enter a new value (stored securely)' },
              { label: 'Clear', value: 'clear', description: 'Remove the stored value' },
            ],
            {
              title: options.title,
              placeHolder: 'Choose an action',
              canPickMany: false,
            }
          );
          if (!action) return;

          if (action.value === 'clear') {
            const confirmed = await vscode.window.showWarningMessage(
              `Clear ${options.title}?`,
              { modal: true },
              'Clear'
            );
            if (confirmed !== 'Clear') return;

            await context.secrets.delete(options.storageKey);
            secretRegistry.set(options.storageKey, undefined);
            vscode.window.showInformationMessage(options.clearedMessage);
            return;
          }
        }

        const value = await vscode.window.showInputBox({
          title: options.title,
          password: true,
          prompt: options.prompt,
          placeHolder: options.placeHolder,
        });

        if (value === undefined) return;
        const trimmed = value.trim();
        if (!trimmed) return;

        await context.secrets.store(options.storageKey, trimmed);
        secretRegistry.set(options.storageKey, trimmed);
        vscode.window.showInformationMessage(options.successMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${options.errorPrefix}: ${message}`);
      }
    });

  const setApiKey = registerSecretCommand('openhands.setApiKey', {
    title: 'LLM API Key',
    secretKey: 'llmApiKey',
    prompt: 'Enter your LLM API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'LLM API Key saved securely.',
    clearedMessage: 'LLM API Key cleared.',
    errorPrefix: 'Failed to save API Key',
  });

  const setOpenAiApiKey = registerSecretStorageCommand('openhands.setOpenAiApiKey', {
    title: 'OpenAI API Key',
    storageKey: 'OPENAI_API_KEY',
    prompt: 'Enter your OpenAI API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'OpenAI API key saved securely.',
    clearedMessage: 'OpenAI API key cleared.',
    errorPrefix: 'Failed to save OpenAI API key',
  });

  const setAnthropicApiKey = registerSecretStorageCommand('openhands.setAnthropicApiKey', {
    title: 'Anthropic API Key',
    storageKey: 'ANTHROPIC_API_KEY',
    prompt: 'Enter your Anthropic API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-ant-...',
    successMessage: 'Anthropic API key saved securely.',
    clearedMessage: 'Anthropic API key cleared.',
    errorPrefix: 'Failed to save Anthropic API key',
  });

  const setOpenRouterApiKey = registerSecretStorageCommand('openhands.setOpenRouterApiKey', {
    title: 'OpenRouter API Key',
    storageKey: 'OPENROUTER_API_KEY',
    prompt: 'Enter your OpenRouter API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-or-...',
    successMessage: 'OpenRouter API key saved securely.',
    clearedMessage: 'OpenRouter API key cleared.',
    errorPrefix: 'Failed to save OpenRouter API key',
  });

  const setLiteLlmApiKey = registerSecretStorageCommand('openhands.setLiteLlmApiKey', {
    title: 'LiteLLM Proxy API Key',
    storageKey: 'LITELLM_API_KEY',
    prompt: 'Enter your LiteLLM Proxy API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'LiteLLM Proxy API key saved securely.',
    clearedMessage: 'LiteLLM Proxy API key cleared.',
    errorPrefix: 'Failed to save LiteLLM Proxy API key',
  });

  const setGeminiLlmApiKey = registerSecretStorageCommand('openhands.setGeminiLlmApiKey', {
    title: 'Gemini API Key (LLM)',
    storageKey: 'GEMINI_API_KEY',
    prompt: 'Enter your Gemini API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'AIza...',
    successMessage: 'Gemini API key saved securely.',
    clearedMessage: 'Gemini API key cleared.',
    errorPrefix: 'Failed to save Gemini API key',
  });

  const setSessionApiKey = registerSecretCommand('openhands.setSessionApiKey', {
    title: 'Session API Key',
    secretKey: 'sessionApiKey',
    prompt: 'Enter your Session API key. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Session API Key saved securely.',
    clearedMessage: 'Session API Key cleared.',
    errorPrefix: 'Failed to save Session API Key',
  });

  const setGithubToken = registerSecretCommand('openhands.setGithubToken', {
    title: 'GitHub Token',
    secretKey: 'githubToken',
    prompt: 'Enter your GitHub token. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'ghp_...',
    successMessage: 'GitHub token saved securely.',
    clearedMessage: 'GitHub token cleared.',
    errorPrefix: 'Failed to save GitHub token',
  });

  const setElevenLabsApiKey = registerSecretCommand('openhands.setElevenLabsApiKey', {
    title: 'ElevenLabs API Key',
    secretKey: 'elevenLabsApiKey',
    prompt: 'Enter your ElevenLabs API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'xi-...',
    successMessage: 'ElevenLabs API key saved securely.',
    clearedMessage: 'ElevenLabs API key cleared.',
    errorPrefix: 'Failed to save ElevenLabs API key',
  });

  const setGeminiApiKey = registerSecretCommand('openhands.setGeminiApiKey', {
    title: 'Gemini API Key (HAL)',
    secretKey: 'geminiApiKey',
    prompt: 'Enter your Gemini API key for HAL decision classification. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Gemini API key saved securely.',
    clearedMessage: 'Gemini API key cleared.',
    errorPrefix: 'Failed to save Gemini API key',
  });

  const setCustomSecret1 = registerSecretCommand('openhands.setCustomSecret1', {
    title: 'Custom Secret 1',
    secretKey: 'customSecret1',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 1 saved securely.',
    clearedMessage: 'Custom secret 1 cleared.',
    errorPrefix: 'Failed to save custom secret 1',
  });

  const setCustomSecret2 = registerSecretCommand('openhands.setCustomSecret2', {
    title: 'Custom Secret 2',
    secretKey: 'customSecret2',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 2 saved securely.',
    clearedMessage: 'Custom secret 2 cleared.',
    errorPrefix: 'Failed to save custom secret 2',
  });

  const setCustomSecret3 = registerSecretCommand('openhands.setCustomSecret3', {
    title: 'Custom Secret 3',
    secretKey: 'customSecret3',
    prompt: 'Enter a secret value. It will be stored securely in VS Code SecretStorage.',
    successMessage: 'Custom secret 3 saved securely.',
    clearedMessage: 'Custom secret 3 cleared.',
    errorPrefix: 'Failed to save custom secret 3',
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
    setVerboseEventLogging: (value) => {
      verboseEventLogging = value;
    },
    getOutputChannel: () => outputChannel,
    renderError,
  });
  const onConfigurationChange = async (e: vscode.ConfigurationChangeEvent) => {
    await onConfigurationChangeBase(e);

    if (e.affectsConfiguration('openhands.elevenlabs')) {
      try {
        const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
        const settings = await settingsMgr.get();
        if (chatView && chatWebviewReady) {
          void chatView.webview.postMessage({ type: 'elevenlabsSettings', elevenlabs: settings.elevenlabs } satisfies HostToWebviewMessage);
        }
      } catch (err: unknown) {
        outputChannel?.appendLine(`[settings] Failed to apply elevenlabs settings update: ${renderError(err)}`);
      }
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange));

  context.subscriptions.push(
    open,
    explainSelection,
    ...diagnosticsCommands,
    startNew,
    configure,
    setApiKey,
    setOpenAiApiKey,
    setAnthropicApiKey,
    setOpenRouterApiKey,
    setLiteLlmApiKey,
    setGeminiLlmApiKey,
    setSessionApiKey,
    setGithubToken,
    setElevenLabsApiKey,
    setGeminiApiKey,
    setCustomSecret1,
    setCustomSecret2,
    setCustomSecret3,
    reconnect,
    pause,
    resume
  );
}

export function deactivate() {
  try { conversation?.disconnect(); } catch { }
  try { terminal?.dispose(); } catch { }
  // Reset module state to ensure clean slate for tests and re-activation
  chatView = undefined;
  conversation = undefined;
  terminal = undefined;
  terminalLogPty = undefined;
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
