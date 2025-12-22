import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { SettingsManager, type OpenHandsSettings } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { renderCondensationSummarizingPrompt, takeLastTeleportableEvents, TELEPORT_FALLBACK_EVENT_LIMIT, TELEPORT_SUMMARY_EVENT_LIMIT } from './shared/halTeleport';
import {
  AgentContext,
  Conversation,
  type ConversationInstance,
  FileEditorTool,
  LLMFactory,
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
  workspaceFilesCount: number;
  selectedContextFiles: string[];
  skillsCount: number;
  attachmentsCount: number;
};

type HalPhase = 'idle' | 'dialogue' | 'awaiting_user' | 'listening' | 'classifying' | 'waiting_remote' | 'error';
type HalEye = 'off' | 'dim' | 'pulsating';
type HalDecision = 'approve_local' | 'teleport_remote' | 'reject';
type ElevenLabsMode = 'bundled' | 'tts_only' | 'voice_confirm';

type HalStateSnapshot = {
  enabled: boolean;
  mode: ElevenLabsMode;
  phase: HalPhase;
  eye: HalEye;
  stepIndex: number | null;
  decision: HalDecision | null;
  lastError: string | null;
};

const DEFAULT_UI_STATE: UiStateSnapshot = {
  input: '',
  showContextPicker: false,
  showSkillsPopover: false,
  showHistory: false,
  workspaceFilesCount: 0,
  selectedContextFiles: [],
  skillsCount: 0,
  attachmentsCount: 0,
};

const DEFAULT_HAL_STATE: HalStateSnapshot = {
  enabled: false,
  mode: 'tts_only',
  phase: 'idle',
  eye: 'off',
  stepIndex: null,
  decision: null,
  lastError: null,
};

function isElevenLabsMode(value: unknown): value is ElevenLabsMode {
  return value === 'bundled' || value === 'tts_only' || value === 'voice_confirm';
}

function isHalPhase(value: unknown): value is HalPhase {
  return (
    value === 'idle' ||
    value === 'dialogue' ||
    value === 'awaiting_user' ||
    value === 'listening' ||
    value === 'classifying' ||
    value === 'waiting_remote' ||
    value === 'error'
  );
}

function isHalEye(value: unknown): value is HalEye {
  return value === 'off' || value === 'dim' || value === 'pulsating';
}

function isHalDecision(value: unknown): value is HalDecision {
  return value === 'approve_local' || value === 'teleport_remote' || value === 'reject';
}

let chatView: vscode.WebviewView | undefined;
let conversation: ConversationInstance | undefined;
let conversationMode: 'local' | 'remote' = 'remote';
let terminal: vscode.Terminal | undefined;
let terminalLogPty: OpenHandsTerminalLogPseudoterminal | undefined;
let nextE2ERequestId = 0;
const pendingRenderedEventsRequests = new Map<string, (info: RenderedEventsInfo) => void>();
const pendingUiStateRequests = new Map<string, (info: UiStateSnapshot) => void>();
const pendingHalStateRequests = new Map<string, (info: HalStateSnapshot) => void>();
let chatWebviewReady = false; // Track if chat WebviewView is ready
let chatLastConversationId: string | undefined;
let chatLastSeenSeq: number | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let conversationStoreRoot: string | undefined;
let lastKnownLlmModel: string | null = null;
let verboseEventLogging = false;
const receivedTerminalEvents: { type?: string; timestamp: number }[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
const MAX_EVENT_BACKLOG = 2000;
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

function nextRequestId(prefix: string): string {
  nextE2ERequestId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextE2ERequestId}`;
}

function createPendingResponse<T>(
  map: Map<string, (value: T) => void>,
  requestId: string,
  timeoutMs: number
): { promise: Promise<T | undefined>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T | undefined>((resolve) => {
    timer = setTimeout(() => {
      map.delete(requestId);
      resolve(undefined);
    }, timeoutMs);
    map.set(requestId, (value: T) => {
      if (timer) clearTimeout(timer);
      map.delete(requestId);
      resolve(value);
    });
  });
  const cancel = () => {
    if (timer) clearTimeout(timer);
    map.delete(requestId);
  };
  return { promise, cancel };
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

const sanitizeTerminalControlSequences = (text: string): string => {
  if (!text.includes('\u001b')) return text;

  const esc = '\u001b';
  const bel = '\u0007';

  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === esc) {
      const introducer = text[i + 1];
      const isOsc = introducer === ']';
      const isStringSequence = isOsc || introducer === 'P' || introducer === '^' || introducer === '_';

      if (isStringSequence) {
        i += 2; // skip ESC + introducer
        while (i < text.length) {
          const c = text[i];
          if (isOsc && c === bel) {
            i += 1;
            break;
          }
          if (c === esc && text[i + 1] === '\\') {
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
};

type TerminalLogPseudoterminalOptions = {
  renderProgress: boolean;
};

class OpenHandsTerminalLogPseudoterminal implements vscode.Pseudoterminal {
  private static readonly PTY_WRITE_CHUNK_SIZE = 16_000;
  private static readonly MAX_PENDING_LINE_CHARS = 200_000;

  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  private closed = false;
  private showedInputHint = false;
  private lastEndedWithNewline = true;
  private readonly renderProgress: boolean;
  private progressCarry = '';
  private progressLine = '';
  private warnedProgressOverflow = false;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(options?: Partial<TerminalLogPseudoterminalOptions>) {
    this.renderProgress = options?.renderProgress ?? true;
  }

  open(): void {
    this.writeLine('[OpenHands] Terminal log (read-only)');
  }

  close(): void {
    if (this.closed) return;
    if (this.progressLine) {
      this.writeRaw(`${this.sanitizeProgressLine(this.progressLine)}\n`);
      this.progressLine = '';
    }
    this.progressCarry = '';
    this.closed = true;
    this.closeEmitter.fire();
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  isClosed(): boolean { return this.closed; }

  ensureNewline(): void {
    if (this.progressLine || this.progressCarry) {
      const line = this.sanitizeProgressLine(this.progressLine);
      this.progressLine = '';
      this.progressCarry = '';
      this.writeRaw(`${line}\n`);
      return;
    }
    if (!this.lastEndedWithNewline) this.writeRaw('\n');
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

  private writeRaw(text: string): void {
    if (this.closed) return;
    const sanitized = sanitizeTerminalControlSequences(text);
    const normalized = normalizeTerminalNewlines(sanitized);

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

  private sanitizeProgressLine(line: string): string {
    // ANSI erase-to-EOL (CSI K) is used by progress bars to clear leftover text.
    // In our coalesced rendering (keeping only last update), the erase is redundant
    // and can be safely removed to keep the log readable.
    if (!line.includes('\u001b[')) return line;

    const esc = '\u001b';
    let out = '';

    for (let i = 0; i < line.length; i++) {
      if (line[i] === esc && line[i + 1] === '[') {
        let j = i + 2;
        while (j < line.length) {
          const code = line.charCodeAt(j);
          const isDigit = code >= 48 && code <= 57;
          const isSemicolon = code === 59;
          if (!isDigit && !isSemicolon) break;
          j += 1;
        }

        if (line[j] === 'K') {
          i = j;
          continue;
        }
      }

      out += line[i];
    }

    return out;
  }

  private splitTrailingIncompleteCsi(text: string): { prefix: string; carry: string } {
    if (!text) return { prefix: '', carry: '' };

    if (text.endsWith('\u001b')) {
      return { prefix: text.slice(0, -1), carry: '\u001b' };
    }

    const escIdx = text.lastIndexOf('\u001b[');
    if (escIdx < 0) return { prefix: text, carry: '' };

    const afterCsi = text.slice(escIdx + 2);
    const hasTerminator = /[@-~]/.test(afterCsi);
    if (hasTerminator) return { prefix: text, carry: '' };

    return { prefix: text.slice(0, escIdx), carry: text.slice(escIdx) };
  }

  private writeWithProgressCoalescing(text: string): void {
    if (this.closed) return;

    // Normalize CRLF -> LF so we can treat standalone CR as progress-only updates.
    const combined = (this.progressCarry + text).replace(/\r\n/g, '\n');
    this.progressCarry = '';

    const { prefix, carry } = this.splitTrailingIncompleteCsi(combined);
    this.progressCarry = carry;
    if (this.progressCarry.length > OpenHandsTerminalLogPseudoterminal.MAX_PENDING_LINE_CHARS) {
      if (!this.warnedProgressOverflow) {
        this.warnedProgressOverflow = true;
        console.warn('[OpenHands] Terminal progress renderer overflowed (carry); flushing to avoid memory growth.');
      }
      this.progressCarry = '';
    }

    const parts = prefix.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      const lastCr = part.lastIndexOf('\r');
      if (lastCr >= 0) {
        this.progressLine = part.slice(lastCr + 1);
      } else {
        this.progressLine += part;
      }

      if (!isLast) {
        const line = this.sanitizeProgressLine(this.progressLine);
        this.progressLine = '';
        this.writeRaw(`${line}\n`);
      }
    }

    if (this.progressLine.length > OpenHandsTerminalLogPseudoterminal.MAX_PENDING_LINE_CHARS) {
      const overflow = this.sanitizeProgressLine(this.progressLine);
      this.progressLine = '';
      this.progressCarry = '';
      if (!this.warnedProgressOverflow) {
        this.warnedProgressOverflow = true;
        console.warn('[OpenHands] Terminal progress renderer overflowed; flushing to avoid memory growth.');
      }
      this.writeRaw(`${overflow}\n`);
    }
  }

  write(text: string): void {
    if (!this.renderProgress) {
      this.writeRaw(text);
      return;
    }
    this.writeWithProgressCoalescing(text);
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
    k.includes('accesskey') ||
    k.endsWith('token') ||
    k.includes('secret') ||
    k === 'llmapikey' ||
    k === 'sessionapikey'
  );
}

const REDACTED = '[REDACTED]';

function redactStringHeuristics(text: string): string {
  let t = text;

  // Authorization / Bearer patterns
  t = t.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);
  t = t.replace(/(Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);

  // Common token prefixes
  t = t.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, REDACTED);
  t = t.replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/gi, REDACTED);
  t = t.replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/gi, REDACTED);

  // AWS access key ids (AKIA..., ASIA...)
  t = t.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED);

  // Common key=value or key: value patterns
  const keyPattern =
    /(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)/gi;
  t = t.replace(new RegExp(`(${keyPattern.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'), (_m, key) => `${key}: ${REDACTED}`);
  t = t.replace(new RegExp(`([?&])(${keyPattern.source})=([^&\\s]+)`, 'gi'), (_m, sep, key) => `${sep}${key}=${REDACTED}`);

  return t;
}

/* eslint-disable @typescript-eslint/no-unsafe-return */
function safeStringify(value: unknown): string {
  try {
    const rendered = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (typeof key === 'string' && shouldRedactKey(key)) return REDACTED;
        if (typeof val === 'string') return redactStringHeuristics(val);
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

async function summarizeWithLocalLlm(settings: OpenHandsSettings, prompt: string): Promise<string> {
  const model = normalizeNonEmptyString(settings.llm.model) ?? '';
  if (!model) {
    throw new Error('LLM model is not configured');
  }
  const apiKey = normalizeNonEmptyString(settings.secrets.llmApiKey);
  if (!apiKey) {
    throw new Error('Missing LLM API key');
  }

  const factory = new LLMFactory({
    provider: settings.llm.provider ?? undefined,
    model,
    baseUrl: normalizeNonEmptyString(settings.llm.baseUrl),
    apiKey,
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
  });

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
        setLastKnownLlmModel: (model) => {
          lastKnownLlmModel = model;
        },
        getLastKnownLlmModel: () => lastKnownLlmModel,
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
      void chatView.webview.postMessage({ type: 'terminalEvent', event });
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

    const cfg = vscode.workspace.getConfiguration();
    verboseEventLogging = Boolean(settings.agent?.debug) || Boolean(cfg.get<boolean>('openhands.devBridge.enabled'));

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = workspaceRoot;

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const savedIdKey = desiredMode === 'local' ? 'openhands.conversationId.local' : 'openhands.conversationId.remote';
    let savedId = options?.uiJustCreated ? undefined : context.workspaceState.get<string>(savedIdKey);

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
        getLastKnownLlmModel: () => lastKnownLlmModel,
        isVerboseEventLogging: () => verboseEventLogging,
        bufferConversationEvent,
        resetConversationEventBacklog,
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

    void chatView.show?.(true);
    const requestId = nextRequestId('renderedEvents');
    const pending = createPendingResponse(pendingRenderedEventsRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryRenderedEvents', requestId });
    if (!posted) {
      pending.cancel();
      return { count: 0, eventTypes: [] };
    }

    const info = await pending.promise;
    if (info) return info;

    // Fallback: if webview didn't respond (e.g., not yet ready), assume events equal to sentTestEvents
    const filtered = sentTestEvents.filter((e) => e.kind !== 'ConversationStateUpdateEvent');
    const types = filtered.map((e) => e.kind ?? 'unknown');
    return { count: types.length, eventTypes: types };
  });

  // Query UI state from webview for E2E testing (toolbar + popovers)
  const queryUiState = vscode.commands.registerCommand('openhands._queryUiState', async () => {
    if (!chatView) {
      return DEFAULT_UI_STATE;
    }

    void chatView.show?.(true);
    const requestId = nextRequestId('uiState');
    const pending = createPendingResponse(pendingUiStateRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryUiState', requestId });
    if (!posted) {
      pending.cancel();
      return DEFAULT_UI_STATE;
    }

    return (await pending.promise) ?? DEFAULT_UI_STATE;
  });

  // Query HAL presentation state from webview for E2E testing (no DOM automation)
  const queryHalState = vscode.commands.registerCommand('openhands._queryHalState', async () => {
    if (!chatView) {
      return DEFAULT_HAL_STATE;
    }

    void chatView.show?.(true);
    const requestId = nextRequestId('halState');
    const pending = createPendingResponse(pendingHalStateRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryHalState', requestId });
    if (!posted) {
      pending.cancel();
      return DEFAULT_HAL_STATE;
    }

    return (await pending.promise) ?? DEFAULT_HAL_STATE;
  });

  // Send a test action to the webview for E2E testing (UI flows without DOM automation)
  const webviewAction = vscode.commands.registerCommand(
    'openhands._webviewAction',
    async (req: { action: string; payload?: unknown } | undefined) => {
      if (!chatView) return { sent: false };
      if (!req || typeof req.action !== 'string' || req.action.length === 0) return { sent: false };
      void chatView.show?.(true);
      const sent = await chatView.webview.postMessage({ type: 'e2eAction', action: req.action, payload: req.payload });
      return { sent };
    }
  );

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensureConversationAndConnection();
    await conversation?.startNewConversation();
  });

  const teleportToRemoteRuntime = vscode.commands.registerCommand('openhands._teleportToRemoteRuntime', async () => {
    const postToWebview = (message: unknown) => {
      if (!chatView || !chatWebviewReady) return false;
      void chatView.webview.postMessage(message);
      return true;
    };

    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
      const settings = await settingsMgr.get();

      const firstServerUrl = typeof settings.servers?.[0]?.url === 'string' ? settings.servers[0].url.trim() : '';
      if (!firstServerUrl) {
        const message = 'No server available';
        outputChannel?.appendLine(`[hal.teleport] ${message}`);
        const posted = postToWebview({ type: 'halTeleportUnavailable', error: message });
        if (!posted) {
          void vscode.window.showErrorMessage(message);
        }
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const { repoName, branchName } = await resolveGitContext(workspaceRoot);
      const introLines = [
        'Teleported from the local VS Code runtime after a HIGH-risk confirmation.',
        `Repo: ${repoName}`,
        `Branch: ${branchName}`,
        'Note: uncommitted local changes may not be present remotely.',
      ];
      const intro = introLines.join('\n');

      const backlogEvents = Array.from(iterConversationEventBacklog(), (item) => item.event);
      const summaryEvents = takeLastTeleportableEvents(backlogEvents, TELEPORT_SUMMARY_EVENT_LIMIT);
      const prompt = renderCondensationSummarizingPrompt({
        previousSummary: '',
        eventStrings: summaryEvents.map((e) => safeStringify(e)),
      });

      let firstRemoteMessage: string;
      try {
        const summary = await summarizeWithLocalLlm(settings, prompt);
        firstRemoteMessage = `${intro}\n\n---\n\n${summary}`;
      } catch (err) {
        const last10 = takeLastTeleportableEvents(backlogEvents, TELEPORT_FALLBACK_EVENT_LIMIT).map((e) => safeStringify(e));
        const reason = renderError(err);
        const block = last10.map((e) => `<EVENT>\n${e}\n</EVENT>`).join('\n\n');
        firstRemoteMessage = `${intro}\n\n---\n\nTeleport summary failed: ${reason}\n\nLast 10 events (Action/Observation/Message only):\n\n${block}`;
      }

      try {
        await conversation?.rejectAction('Teleported to remote runtime');
      } catch (err) {
        outputChannel?.appendLine(`[hal.teleport] Failed to reject local confirmation: ${renderError(err)}`);
      }

      // Ensure we always start a new remote conversation instead of restoring a prior one.
      await context.workspaceState.update('openhands.conversationId.remote', undefined);

      await settingsMgr.update({ serverUrl: firstServerUrl });
      await ensureConversationAndConnection({ uiJustCreated: true });
      await conversation?.startNewConversation();
      await conversation?.sendUserMessage(firstRemoteMessage);
    } catch (err) {
      const reason = renderError(err);
      outputChannel?.appendLine(`[hal.teleport] Teleport failed: ${reason}`);
      const posted = postToWebview({ type: 'halTeleportFailed', error: reason });
      if (!posted) {
        void vscode.window.showErrorMessage(`Teleport failed: ${reason}`);
      }
    }
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
    title: 'Gemini API Key',
    secretKey: 'geminiApiKey',
    prompt: 'Enter your Gemini API key. It will be stored securely in VS Code SecretStorage.',
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
    ensureConversationAndConnection: () => ensureConversationAndConnection(),
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
          void chatView.webview.postMessage({ type: 'elevenlabsSettings', elevenlabs: settings.elevenlabs });
        }
      } catch (err: unknown) {
        outputChannel?.appendLine(`[settings] Failed to apply elevenlabs settings update: ${renderError(err)}`);
      }
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange));

  context.subscriptions.push(
    open,
    diag,
    sendTestEvent,
    queryRenderedEvents,
    queryUiState,
    queryHalState,
    webviewAction,
    startNew,
    teleportToRemoteRuntime,
    configure,
    setApiKey,
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
}
