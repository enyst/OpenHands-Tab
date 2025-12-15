import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TextDecoder } from 'util';
import { SettingsManager, type OpenHandsSettings, type SavedServer } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { FileStore } from '@openhands/agent-sdk-ts';
import {
  Conversation,
  type ConversationInstance,
  FileEditorTool,
  TaskTrackerTool,
  TerminalTool,
  type BashEvent,
  type Event,
  isEvent,
  isMessageEvent,
  isTextContent,
  isBashCommand,
  isBashExit,
  isBashOutput,
} from '@openhands/agent-sdk-ts';
import { OpenHandsChatViewProvider } from './sidebar/OpenHandsChatViewProvider';
import { initialLlmStreamingState, reduceLlmStreamingState } from './shared/llmStreaming';

// Discriminated union for webview → extension messages
type WebviewMessage =
  | { type: 'webviewReady'; conversationId?: string; lastSeenSeq?: number }
  | { type: 'openSettingsPage' }
  | { type: 'openSettings' }
  | { type: 'requestWorkspaceFiles' }
  | { type: 'requestSkills' }
  | { type: 'openSkill'; path: string }
  | { type: 'openWorkspaceFile'; path: string }
  | { type: 'requestHistory' }
  | { type: 'restoreConversation'; id: string }
  | { type: 'getConfig' }
  | { type: 'selectServer'; url: string }
  | { type: 'addServer'; server: SavedServer }
  | { type: 'removeServer'; url: string }
  | { type: 'switchToLocal' }
  | { type: 'selectAttachments' }
  | { type: 'openAttachment'; uri: string }
  | { type: 'send'; text: string; contextFiles?: string[]; attachments?: string[] }
  | { type: 'command'; command: string; reason?: string }
  | { type: 'renderedEventsResponse'; count: number; eventTypes: string[] }
  | { type: 'webviewConsole'; level: string; args: unknown[] }
  | { type: 'webviewError'; message: string; stack?: string }
  | { type: 'webviewNetwork'; phase: string; id: string; method: string; url: string; status?: number; ok?: boolean }
  | { type: 'webviewWebSocket'; phase: string; url: string; code?: number; reason?: string };

let chatView: vscode.WebviewView | undefined;
let conversation: ConversationInstance | undefined;
let conversationMode: 'local' | 'remote' = 'remote';
let terminal: vscode.Terminal | undefined;
let terminalLogPty: OpenHandsTerminalLogPseudoterminal | undefined;
let renderedEventsInfo: { count: number; eventTypes: string[] } | undefined;
let chatWebviewReady = false; // Track if chat WebviewView is ready
let chatLastConversationId: string | undefined;
let chatLastSeenSeq: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let conversationStoreRoot: string | undefined;
let lastKnownLlmModel: string | null = null;
const receivedTerminalEvents: { type?: string; timestamp: number }[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
const MAX_EVENT_BACKLOG = 2000;
const MAX_ATTACHMENT_BYTES_PER_FILE = 200 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 500 * 1024;
type BufferedConversationEvent = { seq: number; event: Event };
const conversationEventBacklog: Array<BufferedConversationEvent | undefined> = [];
let conversationEventBacklogStart = 0;
let conversationEventBacklogSize = 0;
let conversationEventSeq = 0;
let activeConversationId: string | undefined;
// Buffer of test events sent via _sendTestEvent (used as fallback in E2E query)
const sentTestEvents: Event[] = [];
// Track which command_ids have already printed an exit summary to avoid duplicates
const printedExitFor = new Set<string>();

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

function resetConversationEventBacklog(conversationId: string | undefined) {
  activeConversationId = conversationId;
  conversationEventSeq = 0;
  conversationEventBacklogStart = 0;
  conversationEventBacklogSize = 0;
  conversationEventBacklog.length = 0;
}

function bufferConversationEvent(event: Event): number {
  conversationEventSeq += 1;
  const item: BufferedConversationEvent = { seq: conversationEventSeq, event };
  if (conversationEventBacklogSize < MAX_EVENT_BACKLOG) {
    const idx = (conversationEventBacklogStart + conversationEventBacklogSize) % MAX_EVENT_BACKLOG;
    conversationEventBacklog[idx] = item;
    conversationEventBacklogSize += 1;
  } else {
    conversationEventBacklog[conversationEventBacklogStart] = item;
    conversationEventBacklogStart = (conversationEventBacklogStart + 1) % MAX_EVENT_BACKLOG;
  }
  return conversationEventSeq;
}

function* iterConversationEventBacklog(): Iterable<BufferedConversationEvent> {
  for (let i = 0; i < conversationEventBacklogSize; i += 1) {
    const idx = (conversationEventBacklogStart + i) % MAX_EVENT_BACKLOG;
    const item = conversationEventBacklog[idx];
    if (item) yield item;
  }
}

function isProbablyBinary(bytes: Uint8Array): boolean {
  // Heuristic: treat NUL bytes as binary.
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function toAttachmentLabel(uri: vscode.Uri): string {
  try {
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (rel && rel !== uri.fsPath) return rel;
  } catch (err) {
    console.warn('[OpenHands] Failed to compute relative attachment label', err);
  }
  return path.basename(uri.fsPath);
}

function safeParseUri(raw: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(raw, true);
  } catch (err) {
    console.warn('[OpenHands] Skipping invalid URI', err);
    return undefined;
  }
}

async function buildAttachmentBlocks(attachmentUris: vscode.Uri[]): Promise<string> {
  if (attachmentUris.length === 0) return '';

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const blocks: string[] = [];
  let totalIncluded = 0;

  for (const uri of attachmentUris) {
    const label = toAttachmentLabel(uri);
    const begin = `----- BEGIN ATTACHMENT: ${label} -----`;
    const end = `----- END ATTACHMENT: ${label} -----`;

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);

      if (isProbablyBinary(bytes)) {
        blocks.push(`\n\n${begin}\n(attachment skipped: binary file)\n${end}`);
        continue;
      }

      const remaining = MAX_ATTACHMENT_TOTAL_BYTES - totalIncluded;
      if (remaining <= 0) {
        blocks.push(`\n\n${begin}\n(attachment skipped: total attachment size limit reached)\n${end}`);
        continue;
      }

      const maxForThis = Math.min(MAX_ATTACHMENT_BYTES_PER_FILE, remaining);
      const truncated = bytes.length > maxForThis;
      const slice = bytes.slice(0, maxForThis);
      totalIncluded += slice.length;

      const meta = truncated ? `(truncated: first ${slice.length} bytes of ${bytes.length} bytes)\n` : '';
      const text = decoder.decode(slice);
      blocks.push(`\n\n${begin}\n${meta}${text}\n${end}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      blocks.push(`\n\n${begin}\n(attachment skipped: ${reason})\n${end}`);
    }
  }

  return blocks.join('');
}

function flushConversationEventBacklog(params: {
  postMessage: (message: unknown) => Thenable<boolean>;
  clientConversationId?: string;
  clientLastSeenSeq?: number;
}) {
  const currentConversationId = activeConversationId ?? conversation?.getConversationId();
  if (!currentConversationId) {
    return;
  }

  const earliestSeq = conversationEventBacklogSize > 0 ? conversationEventSeq - conversationEventBacklogSize + 1 : undefined;
  const latestSeq = conversationEventBacklogSize > 0 ? conversationEventSeq : undefined;
  const lastSeenSeq = params.clientLastSeenSeq;

  const lastSeenIsValid = typeof lastSeenSeq === 'number' && Number.isFinite(lastSeenSeq);
  const isInRange = lastSeenIsValid && (earliestSeq === undefined || lastSeenSeq >= earliestSeq - 1);
  const needsFullReplay = params.clientConversationId !== currentConversationId || !isInRange;

  if (needsFullReplay) {
    void params.postMessage({ type: 'conversationStarted', conversationId: currentConversationId });
    for (const item of iterConversationEventBacklog()) {
      void params.postMessage({ type: 'event', seq: item.seq, event: item.event });
    }
    return;
  }

  if (latestSeq === undefined || lastSeenSeq === undefined || lastSeenSeq >= latestSeq) {
    return;
  }

  for (const item of iterConversationEventBacklog()) {
    if (item.seq > lastSeenSeq) {
      void params.postMessage({ type: 'event', seq: item.seq, event: item.event });
    }
  }
}

const normalizeTerminalNewlines = (text: string): string => text.replace(/\r?\n/g, '\r\n');

class OpenHandsTerminalLogPseudoterminal implements vscode.Pseudoterminal {
  private static readonly PTY_WRITE_CHUNK_SIZE = 16_000;

  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  private closed = false;
  private showedInputHint = false;
  private lastEndedWithNewline = true;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  open(): void {
    this.writeLine('[OpenHands] Terminal log (read-only)');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeEmitter.fire();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  isClosed(): boolean { return this.closed; }

  ensureNewline(): void {
    if (!this.lastEndedWithNewline) this.write('\n');
  }

  handleInput(_data: string): void {
    if (this.closed || this.showedInputHint) return;
    this.showedInputHint = true;
    this.writeLine('');
    this.writeLine('[OpenHands] This terminal is read-only.');
    this.writeLine('[OpenHands] Use a normal VS Code terminal for manual commands.');
    this.writeLine('');
  }

  private emitChunk(chunk: string): void {
    if (!chunk) return;
    this.writeEmitter.fire(chunk);
    this.lastEndedWithNewline = /\n$/.test(chunk);
  }

  write(text: string): void {
    if (this.closed) return;
    const normalized = normalizeTerminalNewlines(text);

    const max = OpenHandsTerminalLogPseudoterminal.PTY_WRITE_CHUNK_SIZE;
    let start = 0;
    while (start < normalized.length) {
      let end = Math.min(start + max, normalized.length);

      // Prefer to split on newline boundaries if possible
      const slice = normalized.slice(start, end);
      const lastNl = slice.lastIndexOf('\n');
      if (lastNl > 0 && start + lastNl + 1 < normalized.length) {
        end = start + lastNl + 1;
      }

      // Avoid splitting surrogate pairs
      const prevChar = normalized.charCodeAt(end - 1);
      if (prevChar >= 0xd800 && prevChar <= 0xdbff && end < normalized.length) {
        end -= 1;
      }

      // Avoid cutting off an ANSI CSI sequence (ESC [ ... terminator @-~) at the end of the chunk (best-effort)
      const tail = normalized.slice(start, end);
      const escIdx = tail.lastIndexOf('\u001b[');
      if (escIdx >= 0) {
        const afterCsi = tail.slice(escIdx + 2); // after ESC [
        const hasTerminator = /[@-~]/.test(afterCsi); // CSI typically ends with a byte in @-~
        if (!hasTerminator && escIdx > 0) {
          end = start + escIdx;
        }
      }

      this.emitChunk(normalized.slice(start, end));
      start = end;
    }
  }

  writeLine(line: string): void {
    this.write(`${line}\n`);
  }
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

function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes('api_key') ||
    k === 'apikey' ||
    k === 'authorization' ||
    k === 'auth' ||
    k.endsWith('token') ||
    k.includes('secret') ||
    k === 'llmapikey' ||
    k === 'sessionapikey'
  );
}

/* eslint-disable @typescript-eslint/no-unsafe-return */
function safeStringify(value: unknown): string {
  try {
    const rendered = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (typeof key === 'string' && shouldRedactKey(key)) return '[REDACTED]';
        return val;
      }
    );
    if (typeof rendered === 'string') return rendered;
    return '<unserializable: undefined>';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `<unserializable: ${reason}>`;
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-return */

async function listWorkspaceFiles(limit = 500): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return [];
  }
  try {
    // Exclude common directories, build artifacts, and all dotfiles/dotdirs
    const excludePattern = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/coverage/**,**/tmp/**,**/temp/**,**/.*}';
    const uris = await vscode.workspace.findFiles('**/*', excludePattern, limit);
    const unique = new Set<string>();
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative) {
        unique.add(relative);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[OpenHands] Failed to list workspace files', err);
    return [];
  }
}

async function listSkillFiles(): Promise<{ label: string; path: string }[]> {
  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
    return files
      .map((entry) => {
        const absolutePath = path.join(skillsDir, entry.name);
        const label = entry.name.slice(0, -3); // remove .md
        return { label, path: absolutePath };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[OpenHands] Failed to read skills directory', err);
    }
    return [];
  }
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

  const chatViewProvider = new OpenHandsChatViewProvider(context, {
    createMessageHandler: (view) =>
      createWebviewMessageHandler(context, {
        postMessage: (message) => view.webview.postMessage(message),
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
      void chatView.webview.postMessage({ type: 'terminalEvent', event });
    }

    if (conversationMode !== 'local') {
      return;
    }

    // Recreate terminal if not present or if the PTY has been closed
    if (!terminal || !terminalLogPty || terminalLogPty.isClosed?.()) {
      try {
        terminalLogPty = new OpenHandsTerminalLogPseudoterminal();
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
          printedExitFor.add(cid);
        }
      } else if (isBashExit(event)) {
        terminalLogPty.ensureNewline?.();
        terminalLogPty.writeLine(`[Process exited with code ${event.exit_code}]`);
        if ('command_id' in event && (event as { command_id?: string }).command_id) {
          printedExitFor.add((event as { command_id?: string }).command_id as string);
        }
      }
    } catch (e) {
      console.error('[Terminal] Failed to write terminal event:', e);
    }
  };

  async function ensureConversationAndConnection(options?: { uiJustCreated?: boolean }) {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();
    lastKnownLlmModel = settings.llm.model ?? null;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = workspaceRoot;

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const rawSavedId = context.workspaceState.get<string>('openhands.conversationId');
    const savedId = options?.uiJustCreated ? undefined : rawSavedId;
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

      const conversationOptions = {
        serverUrl: settings.serverUrl ?? undefined,
        settings,
        workspaceRoot,
        conversationId: savedId,
        tools: settings.serverUrl ? undefined : createDefaultLocalTools(),
        persistenceDir,
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
      conversation.on('status', (s: string) => {
        outputChannel?.appendLine(`[status] ${s}`);
        if (chatView && chatWebviewReady && chatView.visible) {
          void chatView.webview.postMessage({ type: 'status', status: s, mode: conversationMode, llmModel: lastKnownLlmModel });
        }
      });

      let streamingState = initialLlmStreamingState;
      conversation.on('event', (ev: Event) => {
        const streamingUpdate = reduceLlmStreamingState(streamingState, ev);
        streamingState = streamingUpdate.state;
        const isStateUpdate = ev.kind === 'ConversationStateUpdateEvent';
        const isLlmStreamUpdate = isStateUpdate && (ev.key === 'llm_stream' || ev.key === 'llm_tool_call');

        if (streamingUpdate.started) {
          outputChannel?.appendLine('[llm] Streaming started...');
        }

        if (!isLlmStreamUpdate) {
          outputChannel?.appendLine(`[event] ${safeStringify(ev)}`);
        }

        if (streamingUpdate.completed) {
          outputChannel?.appendLine('[llm] Streaming complete');
        }

        try {
          if (isStateUpdate && ev.key === 'llm_request') {
            const raw = ev.value as {
              model?: unknown;
              tools?: unknown;
              tool_count?: unknown;
            } | undefined;
            const model = typeof raw?.model === 'string' ? raw.model : undefined;
            const names = Array.isArray(raw?.tools)
              ? (raw?.tools as unknown[]).filter((n: unknown) => typeof n === 'string')
              : [];
            const count = typeof raw?.tool_count === 'number' ? raw.tool_count : names.length;
            const summary = `[llm] Sending request${model ? ` to ${model}` : ''} with tools (${count}): ${names.join(', ')}`;
            outputChannel?.appendLine(summary);
          }
        } catch (e) {
          outputChannel?.appendLine(`[error] Failed to create LLM request summary: ${String(e)}`);
        }

        const shouldBufferForReplay = !isLlmStreamUpdate;
        const seq = shouldBufferForReplay ? bufferConversationEvent(ev) : undefined;
        const payload: { type: 'event'; event: Event; seq?: number } = { type: 'event', event: ev };
        if (typeof seq === 'number') payload.seq = seq;

        if (chatView && chatWebviewReady && chatView.visible) {
          void chatView.webview.postMessage(payload);
        }
      });

      conversation.on('error', (err) => {
        const rendered = renderError(err);
        outputChannel?.appendLine(`[error] ${rendered}`);
        if (err instanceof Error && err.stack) {
          outputChannel?.appendLine(err.stack);
        }
        if (chatView && chatWebviewReady && chatView.visible) {
          void chatView.webview.postMessage({ type: 'error', error: rendered });
        }
      });

      conversation.on('conversationStarted', (id: string | undefined) => {
        outputChannel?.appendLine(`[conversation] active=${id ?? 'undefined'}`);
        streamingState = initialLlmStreamingState;
        resetConversationEventBacklog(id);
        void context.workspaceState.update('openhands.conversationId', id);
        if (id && chatView && chatWebviewReady && chatView.visible) {
          void chatView.webview.postMessage({ type: 'conversationStarted', conversationId: id });
        }
      });

      conversation.on('terminal', (event: BashEvent) => handleTerminalEvent(event));

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
        llmModel: lastKnownLlmModel,
      });
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

  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? '';
  const diag = vscode.commands.registerCommand('openhands._diagnostics', () => {
    return {
      chat: {
        hasView: !!chatView,
        visible: chatView?.visible ?? false,
        webviewReady: chatWebviewReady,
        clientConversationId: chatLastConversationId,
        clientLastSeenSeq: chatLastSeenSeq,
      },
      eventBacklog: {
        activeConversationId,
        size: conversationEventBacklogSize,
        latestSeq: conversationEventSeq,
      },
      hasConversation: !!conversation,
      conversationId: conversation?.getConversationId(),
      status: conversation?.getStatus(),
      mode: conversationMode,
      serverUrl: getServerUrl(),
      terminal: {
        hasTerminal: !!terminal,
        received: receivedTerminalEvents.length,
      },
    };
  });

  // Test command to send mock events to webview for E2E testing
  const sendTestEvent = vscode.commands.registerCommand('openhands._sendTestEvent', (event: Event) => {
    sentTestEvents.push(event);
    const seq = bufferConversationEvent(event);
    if (chatView) {
      const payload: { type: 'event'; event: Event; seq?: number } = { type: 'event', event };
      if (typeof seq === 'number') payload.seq = seq;
      void chatView.webview.postMessage(payload);
    }
    return { sent: true, buffered: true, seq };
  });

  // Query rendered events from webview for E2E testing
  const queryRenderedEvents = vscode.commands.registerCommand('openhands._queryRenderedEvents', async () => {
    if (!chatView) {
      return { count: 0, eventTypes: [] };
    }

    // Clear previous response and request from webview
    renderedEventsInfo = undefined;
    void chatView.webview.postMessage({ type: 'queryRenderedEvents' });

    // Wait for response (with timeout)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (renderedEventsInfo !== undefined) {
        return renderedEventsInfo;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Fallback: if webview didn't respond (e.g., not yet ready), assume events equal to sentTestEvents
    const filtered = sentTestEvents.filter((e) => e.kind !== 'ConversationStateUpdateEvent');
    const types = filtered.map((e) => e.kind ?? 'unknown');
    return { count: types.length, eventTypes: types };
  });

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensureConversationAndConnection();
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

  const setApiKey = registerSecretCommand('openhands.setApiKey', {
    title: 'LLM API Key',
    secretKey: 'llmApiKey',
    prompt: 'Enter your LLM API key. It will be stored securely in VS Code SecretStorage.',
    placeHolder: 'sk-...',
    successMessage: 'LLM API Key saved securely.',
    clearedMessage: 'LLM API Key cleared.',
    errorPrefix: 'Failed to save API Key',
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
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('openhands.serverUrl')) {
        try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch { }
        // If switching away from local mode, dispose any lingering log terminal
        const cfg = vscode.workspace.getConfiguration();
        const nextUrl = cfg.get<string>('openhands.serverUrl');
        const nextMode: 'local' | 'remote' = nextUrl ? 'remote' : 'local';
        if (conversationMode === 'local' && nextMode === 'remote') {
          try { terminal?.dispose(); } catch { }
          terminal = undefined;
          terminalLogPty = undefined;
        }
        conversation = undefined;
        await ensureConversationAndConnection();
        return;
      }

      if (e.affectsConfiguration('openhands.conversation.storeRoot')) {
        try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch { }
        conversation = undefined;
        conversationStoreRoot = undefined;
        await ensureConversationAndConnection();
        return;
      }

      if (e.affectsConfiguration('openhands.llm')) {
        try {
          await ensureConversationAndConnection();
          if (conversationMode === 'remote') {
            outputChannel?.appendLine('[settings] LLM settings updated (remote mode: applies on next conversation)');
          } else {
            outputChannel?.appendLine('[settings] LLM settings updated (local mode: applies immediately)');
          }
        } catch (err: unknown) {
          outputChannel?.appendLine(`[settings] Failed to apply LLM settings update: ${renderError(err)}`);
        }
      }
    })
  );

  context.subscriptions.push(
    open,
    diag,
    sendTestEvent,
    queryRenderedEvents,
    startNew,
    configure,
    setApiKey,
    setGithubToken,
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
  renderedEventsInfo = undefined;
  chatWebviewReady = false;
  chatLastConversationId = undefined;
  chatLastSeenSeq = undefined;
  conversationStoreRoot = undefined;
  resetConversationEventBacklog(undefined);
  receivedTerminalEvents.length = 0;
}

/**
 * Message bridge handler: routes messages from webview to extension host.
 *
 * Supported message types:
 * - 'openSettings' / 'openSettingsPage': Opens VS Code settings scoped to OpenHands
 * - 'getConfig': Returns current serverUrl to webview
 * - 'send': Sends user message to agent via active conversation
 * - 'command': Executes agent control commands (reconnect, pause, startNewConversation, approveAction, rejectAction)
 * - 'requestWorkspaceFiles': Returns list of workspace files for @ mentions
 * - 'requestSkills': Returns ~/.openhands/skills markdown files
 * - 'requestHistory': Returns local conversation history (store root configurable)
 * - 'openSkill': Opens the specified skill file in editor
 * - 'renderedEventsResponse': Receives diagnostic info from webview (for E2E tests)
 *
 * Reverse flow (extension → webview):
 * - SDK Conversation callbacks post 'status', 'event', 'error' messages to webview
 * - Config updates post 'configUpdated' messages
 *
 * Security: All network communication happens in extension host (not webview),
 * avoiding CORS and CSP limitations.
 */
type WebviewHost = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

function createWebviewMessageHandler(context: vscode.ExtensionContext, host: WebviewHost) {
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));

  return async (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const message = msg as WebviewMessage;

    switch (message.type) {
      case 'webviewReady': {
        chatWebviewReady = true;
        chatLastConversationId = message.conversationId;
        chatLastSeenSeq = message.lastSeenSeq;

        const initSettings = await settingsMgr.get();
        lastKnownLlmModel = initSettings.llm.model ?? null;

        void host.postMessage({
          type: 'status',
          status: conversation?.getStatus() ?? 'offline',
          mode: conversationMode,
          llmModel: lastKnownLlmModel,
        });

        void host.postMessage({
          type: 'serverListUpdated',
          servers: initSettings.servers,
          serverUrl: initSettings.serverUrl ?? '',
        });

        flushConversationEventBacklog({
          postMessage: host.postMessage,
          clientConversationId: message.conversationId,
          clientLastSeenSeq: message.lastSeenSeq,
        });

        break;
      }
      case 'openSettingsPage':
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
        break;
      case 'requestWorkspaceFiles': {
        const files = await listWorkspaceFiles();
        void host.postMessage({ type: 'workspaceFiles', files });
        break;
      }
      case 'requestSkills': {
        const skills = await listSkillFiles();
        outputChannel?.appendLine(`[skills] Found ${skills.length} skill(s)`);
        void host.postMessage({ type: 'skillsList', skills });
        break;
      }
      case 'openSkill': {
        const skillPath = message.path;
        if (!skillPath) break;
        try {
          const skillsRoot = path.resolve(os.homedir(), '.openhands', 'skills');
          const resolvedPath = path.resolve(skillPath);
          const relative = path.relative(skillsRoot, resolvedPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            void vscode.window.showErrorMessage('Refusing to open skill outside of ~/.openhands/skills');
            break;
          }
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open skill file: ${reason}`);
        }
        break;
      }
      case 'openWorkspaceFile': {
        const p = message.path;
        if (!p) break;
        try {
          const isAbs = path.isAbsolute(p);
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          let resolved: string | undefined;
          if (!isAbs && wsRoot) {
            const candidate = path.resolve(wsRoot, p);
            const rel = path.relative(wsRoot, candidate);
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
              resolved = candidate;
            }
          }
          if (!resolved) {
            resolved = path.resolve(p);
          }
          await fs.stat(resolved);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open file: ${reason}`);
        }
        break;
      }
      case 'requestHistory': {
        try {
          const convRoot = conversationStoreRoot ?? (await resolveConversationStoreRoot(context));
          let ids: string[] = [];
          try {
            ids = FileStore.listConversations(convRoot);
          } catch {
            ids = [];
          }
          const conversations = await Promise.all(
            ids.map(async (id) => {
              try {
                const statePath = path.join(convRoot, id, 'state.json');
                const eventsPath = path.join(convRoot, id, 'events.jsonl');
                const stat = await fs.stat(statePath).catch(async () => fs.stat(eventsPath));
                const timestamp = stat?.mtimeMs ?? Date.now();
                let firstMessage: string | undefined;
                try {
                  const content = await fs.readFile(eventsPath, 'utf8');
                  const line = content.split('\n').find((l) => l.includes('"MessageEvent"'));
                  if (line) {
                    const parsed: unknown = JSON.parse(line);
                    if (isEvent(parsed) && isMessageEvent(parsed)) {
                      const msg = parsed.llm_message;
                      if (msg.role === 'user') {
                        const textPart = msg.content.find(isTextContent);
                        if (textPart) firstMessage = textPart.text;
                      }
                    }
                  }
                } catch {}
                return { id, timestamp: Math.floor(timestamp), firstMessage };
              } catch {
                return { id, timestamp: Date.now() };
              }
            })
          );
          void host.postMessage({ type: 'historyList', conversations });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[history] ${reason}`);
          void host.postMessage({ type: 'historyList', conversations: [] });
        }
        break;
      }
      case 'restoreConversation': {
        const id = message.id;
        if (!id) break;
        try {
          const maybe = conversation?.restoreConversation?.(id);
          void Promise.resolve(maybe).catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[restore] ${reason}`);
            void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[restore] ${reason}`);
          void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
        }
        break;
      }
      case 'getConfig': {
        const settings = await settingsMgr.get();
        void host.postMessage({ type: 'config', serverUrl: settings.serverUrl ?? null, mode: conversationMode });
        break;
      }
      case 'selectServer': {
        const url = message.url;
        const currentSettings = await settingsMgr.get();

        const serverExists = currentSettings.servers.some((s) => s.url === url);
        if (!serverExists && url) {
          await settingsMgr.update({
            servers: [...currentSettings.servers, { url }],
            serverUrl: url,
          });
        } else {
          await settingsMgr.update({ serverUrl: url });
        }

        const updated = await settingsMgr.get();
        void host.postMessage({
          type: 'serverListUpdated',
          servers: updated.servers,
          serverUrl: updated.serverUrl ?? '',
        });
        break;
      }
      case 'addServer': {
        const server = message.server;
        if (!server?.url) break;

        const currentSettings = await settingsMgr.get();
        const exists = currentSettings.servers.some((s) => s.url === server.url);
        if (!exists) {
          const newServers = [...currentSettings.servers, server];
          await settingsMgr.update({ servers: newServers });
          void host.postMessage({
            type: 'serverListUpdated',
            servers: newServers,
            serverUrl: currentSettings.serverUrl ?? '',
          });
        }
        break;
      }
      case 'removeServer': {
        const url = message.url;
        if (!url) break;

        const currentSettings = await settingsMgr.get();
        const newServers = currentSettings.servers.filter((s) => s.url !== url);
        const newServerUrl = currentSettings.serverUrl === url ? '' : currentSettings.serverUrl;

        await settingsMgr.update({
          servers: newServers,
          serverUrl: newServerUrl,
        });

        void host.postMessage({
          type: 'serverListUpdated',
          servers: newServers,
          serverUrl: newServerUrl ?? '',
        });
        break;
      }
      case 'switchToLocal': {
        await settingsMgr.update({ serverUrl: '' });

        const updated = await settingsMgr.get();
        void host.postMessage({
          type: 'serverListUpdated',
          servers: updated.servers,
          serverUrl: '',
        });
        break;
      }
      case 'selectAttachments': {
        try {
          const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            defaultUri,
            openLabel: 'Attach',
          });
          if (!picked || picked.length === 0) break;

          const attachments = await Promise.all(
            picked.map(async (uri) => {
              const label = toAttachmentLabel(uri);
              let sizeBytes: number | undefined;
              try {
                const stat = await vscode.workspace.fs.stat(uri);
                sizeBytes = stat.size;
              } catch (err) {
                console.warn('[OpenHands] Failed to stat attachment', err);
              }
              return { uri: uri.toString(), label, sizeBytes };
            })
          );
          void host.postMessage({ type: 'attachmentsSelected', attachments });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to select attachments: ${reason}`);
        }
        break;
      }
      case 'openAttachment': {
        const raw = message.uri;
        if (!raw) break;
        try {
          const uri = vscode.Uri.parse(raw, true);
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open attachment: ${reason}`);
        }
        break;
      }
      case 'send':
        if (!conversation) break;
        {
          const baseText = message.text;
          const contextFiles = Array.isArray(message.contextFiles)
            ? message.contextFiles.filter((f): f is string => typeof f === 'string' && f.length > 0)
            : [];
          const attachmentUris = Array.isArray(message.attachments)
            ? message.attachments
              .filter((u): u is string => typeof u === 'string' && u.length > 0)
              .map((u) => safeParseUri(u))
              .filter((u): u is vscode.Uri => u !== undefined)
            : [];

          const attachmentsText = await buildAttachmentBlocks(attachmentUris);

          let finalText = baseText;
          if (attachmentsText) {
            finalText += attachmentsText;
          }
          if (contextFiles.length > 0) {
            finalText += `\n\nUser has selected the following files for you to read:\n${contextFiles.join('\n')}`;
          }
          await conversation.sendUserMessage(finalText);
        }
        break;
      case 'command':
        switch (message.command) {
          case 'reconnect':
            conversation?.reconnect();
            break;
          case 'pause':
            await conversation?.pause();
            break;
          case 'startNewConversation':
            await conversation?.startNewConversation();
            break;
          case 'approveAction':
            await conversation?.approveAction();
            break;
          case 'rejectAction':
            await conversation?.rejectAction(message.reason);
            break;
          default:
            console.warn(`Unknown command received from webview: ${message.command}`);
            break;
        }
        break;
      case 'renderedEventsResponse':
        renderedEventsInfo = { count: message.count, eventTypes: message.eventTypes };
        break;
      case 'webviewConsole': {
        if (!devBridgeEnabled) break;
        outputChannel?.appendLine(`[webview ${message.level}] ${message.args.join(' ')}`);
        fileLog(`[console.${message.level}] ${message.args.join(' ')}`);
        break;
      }
      case 'webviewError': {
        if (!devBridgeEnabled) break;
        outputChannel?.appendLine(`[webview error] ${message.message}`);
        if (message.stack) outputChannel?.appendLine(message.stack);
        fileLog(`[error] ${message.message}${message.stack ? `\n${message.stack}` : ''}`);
        break;
      }
      case 'webviewNetwork': {
        if (!devBridgeEnabled) break;
        const line = `[webview net] ${message.phase} id=${message.id} ${message.method} ${message.url}${message.status !== undefined ? ` status=${message.status} ok=${message.ok}` : ''}`;
        outputChannel?.appendLine(line);
        fileLog(line);
        break;
      }
      case 'webviewWebSocket': {
        if (!devBridgeEnabled) break;
        const parts = [`[webview ws] ${message.phase}`];
        if (message.url) parts.push(`url=${message.url}`);
        if (message.code !== undefined) parts.push(`code=${message.code}`);
        if (message.reason) parts.push(`reason=${message.reason}`);
        outputChannel?.appendLine(parts.join(' '));
        fileLog(parts.join(' '));
        break;
      }
    }
  };
}
