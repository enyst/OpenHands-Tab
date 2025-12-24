import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import { AgentOrchestrator } from './AgentOrchestrator';
import { AsyncLock } from './AsyncLock';
import { ConversationState } from './ConversationState';
import { EventLog } from './EventLog';
import type { ChatCompletionRequest, LLMClient, LLMToolDefinition } from '../llm';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl, LLMFactory } from '../llm';
import type { ActionEvent, BashEvent, Event, Message, MessageEvent, ToolCall } from '../types';
import {
  isActionEvent,
  isAgentErrorEvent,
  isMessageEvent,
  isObservationEvent,
  isPauseEvent,
  isSystemPromptEvent,
  isTextContent,
  isUserRejectObservation,
  type SecurityRisk,
} from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';
import { SecretRegistry } from './SecretRegistry';
import type { AgentContext } from '../context';
import { createToolCallErrorEvents } from './toolCallErrorEvents';
import { classifyConversationErrorCode, ClassifiedToolExecutionError, classifyError } from './errorPolicy';

export type AgentRunInput = string | Message;

export interface ConfirmationPolicy {
  policy?: 'never' | 'always' | 'risky';
  riskyThreshold?: SecurityRisk;
  confirmUnknown?: boolean;
}

export interface AgentOptions {
  settings: OpenHandsSettings;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  toolSummarizerClient?: LLMClient;
  tools?: ToolDefinition<unknown, unknown>[];
  events?: EventLog;
  state?: ConversationState;
  secrets?: SecretRegistry;
  agentContext?: AgentContext;
  onTerminalEvent?: (event: BashEvent) => void;
  registry?: import('../llm').LLMRegistry;
  conversationStats?: import('./ConversationStats').ConversationStats;
}

const SYSTEM_PROMPT = 'You are OpenHands, an autonomous AI agent running inside VS Code.';
const SECURITY_RISK_ORDER: SecurityRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

// Simple utility to cap logged/tool result sizes
const TRUNCATE_LIMIT = 2000;
const ELLIPSIS = '…(truncated)';
const CIRCULAR_REFERENCE_MARKER = '[Circular]';
const TOOL_MESSAGE_MAX_CHARS = 8_000;
const TOOL_MESSAGE_CLIP_MARKER = '<response clipped>';
function truncateString(input: string): string {
  return input.length > TRUNCATE_LIMIT ? input.slice(0, TRUNCATE_LIMIT) + ELLIPSIS : input;
}

function deepTruncate(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return truncateString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
    seen.add(value);
    return value.map((v) => deepTruncate(v, seen));
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      try {
        return value.toISOString();
      } catch {
        return String(value);
      }
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return {};
    if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = deepTruncate(v, seen);
    }
    return out;
  }
  return value;
}

function toOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isSafeProfileId(profileId: string): boolean {
  if (!profileId.trim()) return false;
  if (profileId !== profileId.trim()) return false;
  if (profileId.includes('/') || profileId.includes('\\')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(profileId);
}

function truncateToolMessage(text: string, maxChars = TOOL_MESSAGE_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const available = maxChars - TOOL_MESSAGE_CLIP_MARKER.length - 2;
  const half = Math.max(0, Math.floor(available / 2));
  const head = text.slice(0, half);
  const tail = text.slice(-half);
  return `${head}\n${TOOL_MESSAGE_CLIP_MARKER}\n${tail}`;
}

const TOOL_SUMMARY_PROFILE_ID = 'gemini-flash';
const TOOL_SUMMARY_PROMPT_MAX_CHARS = 4_000;
const TOOL_SUMMARY_MAX_CHARS = 1_000;

function stringifyErrorWithCause(error: unknown, maxDepth = 4): string {
  if (error instanceof Error) {
    const base = error.message || error.name || 'Error';
    const anyErr = error as Error & { cause?: unknown };
    if (!anyErr.cause || maxDepth <= 0) return base;
    return `${base}; caused by: ${stringifyErrorWithCause(anyErr.cause, maxDepth - 1)}`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}


// Redaction utilities for tool-call argument logging
const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'apikey',
  'token', 'access_token', 'accessToken', 'refresh_token',
  'authorization', 'authorization_header', 'auth',
  'password', 'pass', 'pwd',
  'secret', 'secret_key', 'secretKey', 'client_secret', 'clientSecret', 'private_key', 'privateKey',
  'awsAccessKeyId', 'awsSecretAccessKey',
  'sessionApiKey', 'session_api_key', 'x_api_key',
]);
function redactObject(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => redactObject(v));
  if (input && typeof input === 'object') {
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (SENSITIVE_KEYS.has(k.toString())) {
        out[k] = '***';
      } else if (typeof v === 'object') {
        out[k] = redactObject(v);
      } else if (typeof v === 'string') {
        out[k] = redactStringHeuristics(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  if (typeof input === 'string') return redactStringHeuristics(input);
  return input;
}
function redactStringHeuristics(text: string): string {
  let t = text;
  // Authorization header
  t = t.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
  // Standalone Bearer tokens
  t = t.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
  // Common token prefixes that may appear without key labels
  const tokenPatterns = [
    /sk-[A-Za-z0-9]{12,}/gi,
    /ghp_[A-Za-z0-9]{12,}/gi,
    /pat_[A-Za-z0-9_]{12,}/gi,
  ];
  tokenPatterns.forEach((pattern) => {
    t = t.replace(pattern, '***');
  });
  // Common key=value or key: value patterns
  const keyPattern = /(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret)/gi;
  t = t.replace(new RegExp(`(${keyPattern.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'), (_m, p1, _p2) => `${p1}: ***`);
  // Query param style ...?api_key=xxx&
  t = t.replace(new RegExp(`([?&])${keyPattern.source}=([^&\\s]+)`, 'gi'), (_m, sep, key) => `${sep}${key}=***`);
  return t;
}
function redactAndTruncateArgs(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const redacted = redactObject(parsed);
    return truncateString(JSON.stringify(redacted));
  } catch {
    return truncateString(redactStringHeuristics(raw));
  }
}


export class Agent extends EventEmitter {
  private readonly workspace: LocalWorkspace;
  private readonly events: EventLog;
  readonly state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly tools: Map<string, ToolDefinition<unknown, unknown>>;
  private readonly confirmation: ConfirmationPolicy;
  private readonly lock = new AsyncLock();
  private orchestratorPromise?: Promise<AgentOrchestrator>;
  private paused = false;
  private cancelled = false;
  private pendingAction?: { toolCall: ToolCall; actionEvent: ActionEvent; args: Record<string, unknown> };
  private pendingWorkspaceAccess?: { paths: string[] };
  private readonly agentContext?: AgentContext;
  private readonly activatedSkillNames: string[] = [];
  private readonly registry?: import('../llm').LLMRegistry;
  private readonly conversationStats?: import('./ConversationStats').ConversationStats;
  private debug: boolean;
  private summarizeToolCallsEnabled = false;
  private pendingToolSummaries: Array<{ toolName: string; summary: string }> = [];
  private toolSummarizerClient?: LLMClient;
  private toolSummarizerInitPromise?: Promise<LLMClient>;
  private toolSummarizerFailed = false;
  private secretValuesForMaskingCache: { signature: string; values: string[] } | null = null;

  constructor(private readonly options: AgentOptions) {
    super();
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.events = options.events ?? new EventLog();
    this.state = options.state ?? new ConversationState({ eventLog: this.events });
    this.state.attachEventLog(this.events);
    this.secrets = options.secrets ?? new SecretRegistry();
    const providedTools = options.tools ?? [];
    this.tools = new Map(providedTools.map((tool) => [tool.name, tool]));
    this.registry = options.registry;
    this.conversationStats = options.conversationStats;
    this.confirmation = { policy: 'never', riskyThreshold: 'MEDIUM', confirmUnknown: true };
    this.agentContext = options.agentContext;
    this.debug = false;
    this.updateDerivedSettings(options.settings);

    this.events.on((event) => this.emit('event', event));
  }

  private updateDerivedSettings(settings: OpenHandsSettings): void {
    this.confirmation.policy = settings?.confirmation?.policy ?? 'never';
    this.confirmation.riskyThreshold = settings?.confirmation?.riskyThreshold ?? 'MEDIUM';
    this.confirmation.confirmUnknown = settings?.confirmation?.confirmUnknown ?? true;
    this.debug = settings?.agent?.debug ?? false;
    this.summarizeToolCallsEnabled = settings?.agent?.summarizeToolCalls ?? false;
    if (!this.summarizeToolCallsEnabled) {
      this.pendingToolSummaries = [];
    }
    // If the user updates settings/secrets, allow retrying tool summarization.
    this.toolSummarizerFailed = false;
    if (!this.options.toolSummarizerClient) {
      this.toolSummarizerClient = undefined;
      this.toolSummarizerInitPromise = undefined;
    }
    this.syncToolSecrets(settings);
  }

  private syncToolSecrets(settings: OpenHandsSettings): void {
    const s = settings?.secrets;
    this.secrets.set('GITHUB_TOKEN', s?.githubToken);
    this.secrets.set('CUSTOM_SECRET_1', s?.customSecret1);
    this.secrets.set('CUSTOM_SECRET_2', s?.customSecret2);
    this.secrets.set('CUSTOM_SECRET_3', s?.customSecret3);
    this.secrets.set('ELEVENLABS_API_KEY', s?.elevenLabsApiKey);
  }

  private getSecretValuesForMasking(): string[] {
    const configuredSecrets = Object.values(this.options.settings?.secrets ?? {})
      .filter((secret): secret is string => typeof secret === 'string')
      .map((secret) => secret.trim())
      .filter(Boolean);
    const registeredSecrets = this.secrets.getRegisteredValues();
    const signature = `${configuredSecrets.join('\u0000')}\u0001${registeredSecrets.join('\u0000')}`;
    if (this.secretValuesForMaskingCache?.signature === signature) {
      return this.secretValuesForMaskingCache.values;
    }

    const values = new Set<string>();
    const maybePush = (candidate: unknown) => {
      if (typeof candidate !== 'string') return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      if (/^[A-Z0-9_]+$/.test(trimmed)) {
        values.add(trimmed);
        const envValue = process.env[trimmed];
        if (envValue) {
          values.add(envValue);
        }
      } else {
        values.add(trimmed);
      }
    };

    for (const secret of configuredSecrets) {
      maybePush(secret);
    }

    for (const secret of registeredSecrets) {
      maybePush(secret);
    }

    const envKeyLooksSensitive = /(?:^|_)(?:API_?KEY|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD)(?:$|_)/i;
    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue;
      if (!envKeyLooksSensitive.test(key)) continue;
      values.add(value);
    }

    const computed = Array.from(values)
      .filter((value) => value.length >= 8)
      .sort((a, b) => b.length - a.length);
    this.secretValuesForMaskingCache = { signature, values: computed };
    return computed;
  }

  private maskSecretsInText(text: string): string {
    let masked = text;
    for (const secret of this.getSecretValuesForMasking()) {
      masked = masked.replaceAll(secret, '***');
    }
    return redactStringHeuristics(masked);
  }

  private maskSecretsInUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') {
      return this.maskSecretsInText(value);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
      seen.add(value);
      return value.map((item) => this.maskSecretsInUnknown(item, seen));
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) return value;
      if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
      seen.add(value);
      const masked: Record<string, unknown> = {};
      for (const [key, inner] of entries) {
        masked[key] = this.maskSecretsInUnknown(inner, seen);
      }
      return masked;
    }
    return value;
  }

  private formatToolMessageText(toolCall: ToolCall, result: unknown): string {
    const toolName = toolCall.function.name;
    const asRecord = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

    if (toolName === 'terminal') {
      const record = asRecord(result) ?? {};
      const commandFromArgs = (() => {
        const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments);
        if (!rawArgs) return undefined;
        try {
          const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
          return toOptionalNonEmptyString(parsed.command) ?? rawArgs;
        } catch {
          return rawArgs;
        }
      })();
      const command = toOptionalNonEmptyString(record.command) ?? commandFromArgs;
      const stdout = typeof record.stdout === 'string' ? record.stdout.trimEnd() : '';
      const stderr = typeof record.stderr === 'string' ? record.stderr.trimEnd() : '';
      const exitCode = typeof record.exit_code === 'number' ? record.exit_code : undefined;
      const timedOut = record.timeout === true;

      const parts: string[] = [];
      if (command) {
        parts.push(command.startsWith('$') ? command : `$ ${command}`);
      }
      const output = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;
      if (output) parts.push(output);
      if (typeof exitCode === 'number') {
        parts.push(`[Command finished with exit code ${exitCode}]`);
      } else {
        parts.push('[Command finished]');
      }
      if (timedOut) parts.push('[Command timed out]');
      return parts.join('\n');
    }

    if (toolName === 'file_editor') {
      const record = asRecord(result) ?? {};
      const command = toOptionalNonEmptyString(record.command);
      const targetPath = toOptionalNonEmptyString(record.path);
      const headerParts = ['file_editor'];
      if (command) headerParts.push(command);
      if (targetPath) headerParts.push(targetPath);
      const header = headerParts.join(' ');
      const content = typeof record.new_content === 'string' ? record.new_content : record.new_content === null ? '<file removed>' : '';
      return content ? `${header}\n${content}` : header;
    }

    if (typeof result === 'string') return result;
    if (result === null || result === undefined) return String(result);
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return Object.prototype.toString.call(result);
    }
  }

  private async maybeSummarizeToolCall(toolCall: ToolCall, result: unknown): Promise<void> {
    if (!this.summarizeToolCallsEnabled) return;
    if (this.toolSummarizerFailed) return;

    try {
      const summary = await this.summarizeToolCall(toolCall, result);
      if (!summary) return;
      this.pendingToolSummaries.push({ toolName: toolCall.function.name, summary });
    } catch (error) {
      this.toolSummarizerFailed = true;
      if (this.debug) {
        console.warn('[Agent] Tool call summarization failed; disabling for this session:', error);
      }
    }
  }

  private async summarizeToolCall(toolCall: ToolCall, result: unknown): Promise<string | undefined> {
    const client = await this.getToolSummarizerClient();
    const toolName = toolCall.function.name;
    const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments) ?? '';
    const safeArgs = rawArgs ? redactAndTruncateArgs(rawArgs) : '';

    const formatted = this.formatToolMessageText(toolCall, result);
    const masked = this.maskSecretsInText(formatted);
    const clipped = truncateToolMessage(masked, TOOL_SUMMARY_PROMPT_MAX_CHARS);

    const prompt = [
      'Write a concise (1–3 sentence) summary of a tool execution performed by an autonomous coding agent.',
      '- Focus on the action taken and key outcome.',
      '- Do not include secrets or long output excerpts.',
      '',
      `Tool: ${toolName}`,
      `Arguments: ${safeArgs || '(none)'}`,
      '',
      'Result (redacted + clipped):',
      clipped || '(empty)',
    ].join('\n');

    const request: ChatCompletionRequest = {
      systemPrompt: 'You summarize tool executions for an autonomous coding agent.',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    };

    let text = '';
    for await (const chunk of client.streamChat(request)) {
      if (chunk.type === 'text') text += chunk.text;
    }

    const summary = this.maskSecretsInText(text).trim();
    if (!summary) return undefined;

    return summary.length > TOOL_SUMMARY_MAX_CHARS ? summary.slice(0, TOOL_SUMMARY_MAX_CHARS) + '…' : summary;
  }

  private async getToolSummarizerClient(): Promise<LLMClient> {
    if (this.options.toolSummarizerClient) return this.options.toolSummarizerClient;
    if (this.toolSummarizerClient) return this.toolSummarizerClient;
    if (this.toolSummarizerInitPromise) return this.toolSummarizerInitPromise;

    this.toolSummarizerInitPromise = (async () => {
      const factory = new LLMFactory(
        {
          profileId: TOOL_SUMMARY_PROFILE_ID,
          model: TOOL_SUMMARY_PROFILE_ID,
          usageId: 'tool-summarizer',
          temperature: 0.2,
          maxOutputTokens: 256,
        },
        { secrets: this.secrets },
      );
      const client = await factory.createClient();
      this.toolSummarizerClient = client;
      return client;
    })();

    return this.toolSummarizerInitPromise;
  }

  /**
   * Updates the agent's settings at runtime.
   *
   * Changes are applied under the agent lock so settings updates can't race with
   * an active run. New settings take effect on the next run.
   */
  setSettings(settings: OpenHandsSettings): void {
    void this.lock.acquire(() => {
      this.options.settings = settings;
      this.updateDerivedSettings(settings);

      // Force the next run to rebuild the LLM client from updated settings.
      this.orchestratorPromise = undefined;
      return Promise.resolve();
    });
  }

  get pendingActionId(): string | undefined {
    return this.pendingAction?.actionEvent.id;
  }

  private emitRestorePendingConfirmationDiagnostic(reason: string, detail?: Record<string, unknown>): void {
    this.events.push({
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      key: 'restore_pending_confirmation',
      value: { restored: false, reason, ...detail },
    } as Event);
  }

  private clearWaitingForConfirmation(reason: string, detail?: Record<string, unknown>, emitError = false): void {
    this.emitRestorePendingConfirmationDiagnostic(reason, detail);
    if (emitError) {
      const lines = [
        'Pending confirmation could not be restored after reload; clearing WAITING_FOR_CONFIRMATION state.',
        `Reason: ${reason}`,
        detail ? `Context: ${JSON.stringify(detail)}` : undefined,
      ].filter(Boolean) as string[];
      this.events.push({
        kind: 'ConversationErrorEvent',
        source: 'agent',
        code: 'restore_pending_confirmation_failed',
        detail: lines.join('\n'),
      } as Event);
    }
    this.state.setStatus('IDLE');
  }

  restorePendingConfirmation(): void {
    if (this.pendingAction) return;
    if (this.state.snapshot.status !== 'WAITING_FOR_CONFIRMATION') return;

    const events = this.events.list();
    let pauseIndex = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (isPauseEvent(event) && event.source === 'agent') {
        pauseIndex = i;
        break;
      }
    }

    if (pauseIndex === -1) {
      this.clearWaitingForConfirmation('missing_pause_event', undefined, true);
      return;
    }

    let action: ActionEvent | undefined;
    let actionIndex = -1;
    for (let i = pauseIndex - 1; i >= 0; i--) {
      const event = events[i];
      if (!isActionEvent(event)) continue;
      action = event;
      actionIndex = i;
      break;
    }

    if (!action || actionIndex < 0) {
      this.clearWaitingForConfirmation('missing_action_event', { pauseIndex }, true);
      return;
    }

    const toolCallId = action.tool_call_id;
    const alreadyResolved = events.slice(actionIndex + 1).some((event) => {
      if (isObservationEvent(event) || isUserRejectObservation(event) || isAgentErrorEvent(event)) {
        return event.tool_call_id === toolCallId;
      }
      return false;
    });

    if (alreadyResolved) {
      this.clearWaitingForConfirmation('tool_call_already_resolved', { toolCallId });
      return;
    }

    const actionArgs: Record<string, unknown> = action.action ?? {};
    const workspaceAccess = this.getRequiredWorkspaceAccess(action.tool_name, actionArgs);

    this.pendingAction = { toolCall: action.tool_call, actionEvent: action, args: actionArgs };
    this.pendingWorkspaceAccess = workspaceAccess;
  }

  async run(input: AgentRunInput): Promise<Message | undefined> {
    this.cancelled = false;
    return this.lock.acquire(async () => {
      this.ensureSystemPrompt();
      this.pushUserMessage(input);
      return this.runLoop();
    });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.events.push({ kind: 'PauseEvent', source: 'user' });
    this.state.setStatus('PAUSED');
  }

  resume(): Promise<Message | undefined> {
    if (!this.paused) return Promise.resolve(undefined);
    this.paused = false;
    this.state.setStatus('RUNNING');
    return this.lock.acquire(async () => this.runLoop());
  }

  cancel(): void {
    this.cancelled = true;
    this.pendingAction = undefined;
    this.pendingWorkspaceAccess = undefined;
    this.state.setStatus('CANCELLED');
  }

  async approveAction(): Promise<void> {
    if (!this.pendingAction) return;
    await this.lock.acquire(async () => {
      const pending = this.pendingAction!;
      const pendingWorkspaceAccess = this.pendingWorkspaceAccess;
      this.pendingAction = undefined;
      this.pendingWorkspaceAccess = undefined;
      if (pendingWorkspaceAccess) {
        for (const p of pendingWorkspaceAccess.paths) {
          this.workspace.allowPath(p);
        }
      }
      this.state.setStatus('RUNNING');
      try {
        await this.executeTool(pending.toolCall, pending.actionEvent, pending.args);
      } catch (error) {
        if (error instanceof ClassifiedToolExecutionError && error.classification === 'conversation') {
          this.events.push(this.toConversationErrorEvent(error, { code: error.code, message: error.message }));
        }
        this.state.setStatus('IDLE');
        throw error;
      }
      await this.runLoop();
    });
  }

  rejectAction(reason?: string): void {
    if (!this.pendingAction) return;
    const { actionEvent, toolCall } = this.pendingAction;
    const rejectionReason = reason ?? 'User rejected the action';
    this.pendingAction = undefined;
    this.pendingWorkspaceAccess = undefined;
    this.events.push({
      kind: 'UserRejectObservation',
      source: 'environment',
      rejection_reason: rejectionReason,
      tool_name: actionEvent.tool_name,
      tool_call_id: toolCall.id,
      action_id: actionEvent.id!,
    } as Event);

    // OpenAI-compatible providers require that assistant tool_calls are followed by tool messages for each tool_call_id.
    // If the user rejects a tool call, emit a synthetic tool response so subsequent LLM calls remain valid.
    const rejectionText = truncateToolMessage(this.maskSecretsInText(`User rejected tool call: ${rejectionReason}`));
    this.events.push({
      kind: 'MessageEvent',
      source: 'environment',
      llm_message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: [{ type: 'text', text: rejectionText }],
      },
    } as Event);

    this.state.setStatus('IDLE');
  }

  private pauseForConfirmation(
    pendingAction: { toolCall: ToolCall; actionEvent: ActionEvent; args: Record<string, unknown> },
    pendingWorkspaceAccess?: { paths: string[] },
  ): void {
    this.pendingAction = pendingAction;
    this.pendingWorkspaceAccess = pendingWorkspaceAccess;
    this.state.setStatus('WAITING_FOR_CONFIRMATION');
    this.events.push({ kind: 'PauseEvent', source: 'agent' });
  }

  private async runLoop(): Promise<Message | undefined> {
    if (this.paused || this.pendingAction || this.cancelled) {
      return undefined;
    }

    const maxIterations = this.clampMaxIterations();
    let orchestrator: AgentOrchestrator;
    try {
      orchestrator = await this.getOrchestrator();
    } catch (error) {
      const classified = classifyError(error, { stage: 'llm_init' });
      this.events.push(this.toConversationErrorEvent(error, { code: classified.code }));
      this.state.setStatus('IDLE');
      // Allow a future retry after settings/secrets are updated.
      this.orchestratorPromise = undefined;
      return undefined;
    }
    let lastAssistantMessage: Message | undefined;

    while (!this.paused && !this.pendingAction && !this.cancelled && this.state.snapshot.iteration < maxIterations) {
      this.state.setStatus('RUNNING');
      const request = this.buildChatRequest();
      // Emit a lightweight debug/state event so hosts can log what tools are actually sent
      try {
        const toolNames = (request.tools ?? []).map((t) => t.function?.name).filter(Boolean);
        this.events.push({
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          key: 'llm_request',
          value: { model: this.options.settings?.llm?.model, tool_count: toolNames.length, tools: toolNames },
        } as Event);
      } catch (error) {
        if (this.debug) {
          console.warn('[Agent] Failed to emit llm_request debug event:', error);
          this.events.push({
            kind: 'ConversationErrorEvent',
            source: 'agent',
            detail: `Debug event emission failed: ${error instanceof Error ? error.message : String(error)}`,
          } as Event);
        }
      }
      let response;
      try {
        response = await orchestrator.runChat(request);
      } catch (error) {
        const classified = classifyError(error, { stage: 'llm_request' });
        this.events.push(this.toConversationErrorEvent(error, { code: classified.code }));
        this.state.setStatus('IDLE');
        break;
      }
      this.pendingToolSummaries = [];

      const assistantEvent: MessageEvent = {
        kind: 'MessageEvent',
        source: 'agent',
        llm_message: response.message,
      };
      this.events.push(assistantEvent);
      if (response.usage) {
        this.state.setValue('llm_usage', response.usage);
      }
      this.state.incrementIteration();
      lastAssistantMessage = response.message;

      const toolCalls = response.message.tool_calls ?? [];
      if (!toolCalls.length) {
        this.state.setStatus('IDLE');
        break;
      }

      let toolExecutionFailed = false;
      for (const toolCall of toolCalls) {
        // Log raw tool call for debugging visibility
        try {
          const rawArgs = toolCall.function?.arguments ?? '';
          const safeArgs = typeof rawArgs === 'string' ? redactAndTruncateArgs(rawArgs) : rawArgs;
          this.events.push({
            kind: 'ConversationStateUpdateEvent',
            source: 'agent',
            key: 'llm_tool_call_raw',
            value: {
              id: toolCall.id,
              name: toolCall.function?.name ?? '',
              arguments: safeArgs,
            },
          } as Event);
        } catch (error) {
          if (this.debug) {
            console.warn('[Agent] Failed to emit tool_call_raw debug event:', error);
            this.events.push({
              kind: 'ConversationErrorEvent',
              source: 'agent',
              detail: `Debug event emission failed for tool call: ${error instanceof Error ? error.message : String(error)}`,
            } as Event);
          }
        }

        const parsed = this.parseToolArgs(toolCall);
        if (!parsed) {
          toolExecutionFailed = true;
          continue;
        }
        const { args, securityRisk } = parsed;
        const actionArgs = args ?? {};

        const actionEvent = this.createActionEvent(response.message, toolCall, args, securityRisk);
        const recordedAction = this.events.push(actionEvent) as ActionEvent;

        const workspaceAccess = this.getRequiredWorkspaceAccess(toolCall.function.name, actionArgs);
        if (workspaceAccess) {
          this.pauseForConfirmation({ toolCall, actionEvent: recordedAction, args: actionArgs }, workspaceAccess);
          return lastAssistantMessage;
        }

        if (this.requiresConfirmation(recordedAction)) {
          this.pauseForConfirmation({ toolCall, actionEvent: recordedAction, args: actionArgs });
          return lastAssistantMessage;
        }

        try {
          await this.executeTool(toolCall, recordedAction, actionArgs);
        } catch (error) {
          if (error instanceof ClassifiedToolExecutionError && error.classification === 'conversation') {
            this.events.push(this.toConversationErrorEvent(error, { code: error.code, message: error.message }));
            this.state.setStatus('IDLE');
            return lastAssistantMessage;
          }
          toolExecutionFailed = true;
          // Continue processing other tool calls but mark this iteration as failed
        }
      }

      if (toolExecutionFailed) {
        this.state.setStatus('IDLE');
        continue;
      }
    }

    return lastAssistantMessage;
  }

  private clampMaxIterations(): number {
    const raw = this.options.settings?.conversation?.maxIterations;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
    return Math.min(500, Math.max(1, n));
  }

  private buildChatRequest() {
    const systemPrompt = this.buildSystemPrompt();
    const rawMessages = this.events
      .list()
      .filter(isMessageEvent)
      .map((event) => {
        if (event.source === 'user' && event.extended_content?.length) {
          return { ...event.llm_message, content: [...event.llm_message.content, ...event.extended_content] };
        }
        return event.llm_message;
      });
    const messages = (() => {
      const sanitized = this.sanitizeChatMessages(rawMessages);
      const summaryMessage = this.buildToolSummaryMessage();
      return summaryMessage ? [...sanitized, summaryMessage] : sanitized;
    })();
    const tools = this.getToolDefinitions();
    return { systemPrompt, messages, tools };
  }

  private buildToolSummaryMessage(): Message | undefined {
    if (!this.summarizeToolCallsEnabled) return undefined;
    if (!this.pendingToolSummaries.length) return undefined;

    if (this.pendingToolSummaries.length === 1) {
      const only = this.pendingToolSummaries[0];
      return {
        role: 'assistant',
        content: [{ type: 'text', text: `Tool summary (${only.toolName}): ${only.summary}` }],
      };
    }

    const lines = [
      'Tool summaries:',
      ...this.pendingToolSummaries.map((entry) => `- ${entry.toolName}: ${entry.summary}`),
    ];
    return { role: 'assistant', content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // OpenAI-compatible providers require that assistant tool_calls are followed by tool messages for each tool_call_id.
  // If we encounter conversation-level tool execution failures, we intentionally do not emit tool messages; sanitize
  // orphan tool_calls from the next request to avoid poisoning the conversation history.
  private sanitizeChatMessages(messages: Message[]): Message[] {
    const sanitized: Array<Message | null> = [];

    let pendingAssistantIndex: number | null = null;
    let pendingAssistantMessage: Message | null = null;
    let pendingToolResponseIds = new Set<string>();

    const hasMeaningfulAssistantContent = (message: Message): boolean => {
      if (message.responses_reasoning_item) return true;
      if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length > 0) return true;
      return message.content.some((part) => (part.type === 'text' ? part.text.trim().length > 0 : true));
    };

    const flushPendingAssistant = () => {
      if (pendingAssistantIndex === null || !pendingAssistantMessage) return;

      const originalToolCalls = pendingAssistantMessage.tool_calls ?? [];
      const matchingToolCalls = originalToolCalls.filter((call) => pendingToolResponseIds.has(call.id));

      if (matchingToolCalls.length === 0) {
        const withoutToolCalls: Message = { ...pendingAssistantMessage, tool_calls: undefined };
        sanitized[pendingAssistantIndex] = hasMeaningfulAssistantContent(withoutToolCalls) ? withoutToolCalls : null;
      } else {
        sanitized[pendingAssistantIndex] = { ...pendingAssistantMessage, tool_calls: matchingToolCalls };
      }

      pendingAssistantIndex = null;
      pendingAssistantMessage = null;
      pendingToolResponseIds = new Set<string>();
    };

    for (const message of messages) {
      if (message.role === 'assistant') {
        flushPendingAssistant();

        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          pendingAssistantIndex = sanitized.length;
          pendingAssistantMessage = message;
          pendingToolResponseIds = new Set<string>();
        }

        sanitized.push(message);
        continue;
      }

      if (pendingAssistantMessage && message.role === 'tool' && typeof message.tool_call_id === 'string') {
        pendingToolResponseIds.add(message.tool_call_id);
      }

      sanitized.push(message);
    }

    flushPendingAssistant();

    return sanitized.filter((message): message is Message => Boolean(message));
  }

  private getToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => {
      if (typeof tool.getToolDefinition === 'function') {
        return tool.getToolDefinition();
      }
      const definition: LLMToolDefinition['function'] = { name: tool.name };
      if (tool.description) {
        definition.description = tool.description;
      }
      if (tool.parameters) {
        definition.parameters = tool.parameters;
      }
      return { type: 'function', function: definition };
    });
  }

  private getToolDefinitionsForEvent(): Record<string, unknown>[] {
    return this.getToolDefinitions().map((tool) => tool as unknown as Record<string, unknown>);
  }

  private buildSystemPrompt(): string {
    let systemPrompt = SYSTEM_PROMPT;
    if (this.agentContext) {
      const suffix = this.agentContext.getSystemMessageSuffix({ secretNames: this.secrets.getRegisteredNames() });
      if (suffix) {
        systemPrompt += '\n\n' + suffix;
      }
    }

    const summaries = this.getToolDefinitions()
      .map((tool) => {
        const description = tool.function.description;
        if (!description) return undefined;
        return `- ${tool.function.name}: ${description}`;
      })
      .filter((value): value is string => Boolean(value));

    if (summaries.length) {
      systemPrompt += '\n\nAvailable tools:\n' + summaries.join('\n');
    }

    return systemPrompt;
  }

  private async getOrchestrator(): Promise<AgentOrchestrator> {
    if (!this.orchestratorPromise) {
      this.orchestratorPromise = (async () => {
        const client = this.options.llmClient ?? (await this.createLlmClientFromSettings());
        return new AgentOrchestrator(client, { events: this.events, state: this.state });
      })();
    }

    return this.orchestratorPromise;
  }

  private createLlmClientFromSettings(): Promise<LLMClient> {
    const s = this.options.settings;
    const profileId = toOptionalNonEmptyString(s.llm?.profileId);
    const model = toOptionalNonEmptyString(s.llm?.model);
    if (!profileId && !model) {
      return Promise.reject(new Error('LLM model is not configured'));
    }
    const configuredUsageId = toOptionalNonEmptyString(s.llm?.usageId);
    const effectiveUsageId = profileId && (!configuredUsageId || configuredUsageId === 'default-llm')
      ? profileId
      : configuredUsageId;

    const configuredApiKey = toOptionalNonEmptyString(s.secrets?.llmApiKey);
    const configuredApiKeyIsReference =
      typeof configuredApiKey === 'string' && /^[A-Z0-9_]+$/.test(configuredApiKey);
    const configuredApiKeyInline = configuredApiKeyIsReference ? undefined : configuredApiKey;
    if (configuredApiKeyInline) {
      this.secrets.set('openhands.llmApiKey', configuredApiKeyInline);
    }

    const preferredApiKeys = (() => {
      if (!profileId || !isSafeProfileId(profileId)) return undefined;
      const keys: string[] = [`openhands.llmProfileApiKey.${profileId}`];
      if (configuredApiKeyIsReference && configuredApiKey) {
        keys.push(configuredApiKey);
      }
      return keys;
    })();

    const config = {
      profileId,
      provider: s.llm.provider ?? undefined,
      model: model ?? '',
      openaiApiMode: s.llm.openaiApiMode ?? undefined,
      usageId: effectiveUsageId,
      baseUrl: s.llm.baseUrl ?? undefined,
      apiKey: profileId ? undefined : configuredApiKey,
      apiVersion: s.llm.apiVersion ?? undefined,
      timeoutSeconds: s.llm.timeout ?? undefined,
      temperature: s.llm.temperature ?? undefined,
      topP: s.llm.topP ?? undefined,
      topK: s.llm.topK ?? undefined,
      maxInputTokens: s.llm.maxInputTokens ?? undefined,
      maxOutputTokens: s.llm.maxOutputTokens ?? undefined,
      reasoningEffort: s.llm.reasoningEffort ?? undefined,
      reasoningSummary: s.llm.reasoningSummary ?? undefined,
      inputCostPerToken: s.llm.inputCostPerToken ?? undefined,
      outputCostPerToken: s.llm.outputCostPerToken ?? undefined,
    };
    const factory = new LLMFactory(config, {
      secrets: this.secrets,
      preferredApiKeys,
      registry: this.registry,
      onMetricsUpdate: (usageId, metrics) => {
        if (!this.conversationStats) return;
        // ensure entry exists and reference the same metrics
        if (!this.conversationStats.usageToMetrics[usageId]) {
          this.conversationStats.usageToMetrics[usageId] = metrics;
        }
        this.state.setValue('stats', this.conversationStats.toJSON());
      },
    });
    return factory.createClient();
  }

  private toConversationErrorEvent(error: unknown, options?: { code?: string; message?: string }): Event {
    const message = options?.message ?? stringifyErrorWithCause(error);
    const code = options?.code ?? classifyConversationErrorCode(message);
    const model = toOptionalNonEmptyString(this.options.settings?.llm?.model);
    const configuredBaseUrl = toOptionalNonEmptyString(this.options.settings?.llm?.baseUrl);
    const configuredProvider = this.options.settings?.llm?.provider ?? undefined;
    const provider = configuredProvider ?? detectProviderFromBaseUrl(configuredBaseUrl);
    const effectiveBaseUrl = configuredBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider] ?? DEFAULT_PROVIDER_BASE_URLS.openai;
    const configuredApiKey = toOptionalNonEmptyString(this.options.settings?.secrets?.llmApiKey);
    const hasInlineApiKey =
      typeof configuredApiKey === 'string' && !/^[A-Z0-9_]+$/.test(configuredApiKey);
    const apiKeyStatus = configuredApiKey ? (hasInlineApiKey ? 'inline' : 'reference') : 'unset';
    const mode = this.options.settings?.serverUrl ? 'remote' : 'local';
    const serverUrl = toOptionalNonEmptyString(this.options.settings?.serverUrl);

    const contextParts = [
      `mode=${mode}`,
      `llm.model=${model ?? '(unset)'}`,
      `llm.provider=${provider}`,
      `llm.baseUrl=${configuredBaseUrl ?? '(default)'}`,
      `llm.effectiveBaseUrl=${effectiveBaseUrl}`,
      `llm.apiKey=${apiKeyStatus}`,
    ];
    if (serverUrl) contextParts.push(`serverUrl=${serverUrl}`);

    const detail = `${message} (${contextParts.join(', ')})`;
    return { kind: 'ConversationErrorEvent', source: 'agent', ...(code ? { code } : {}), detail } as Event;
  }

  private ensureSystemPrompt() {
    const existing = this.events.list().find(isSystemPromptEvent);
    if (existing) return;

    const systemPrompt = this.buildSystemPrompt();
    this.events.push({
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: systemPrompt },
      tools: this.getToolDefinitionsForEvent(),
    } as Event);
  }

  private pushUserMessage(input: AgentRunInput) {
    const message: Message =
      typeof input === 'string'
        ? { role: 'user', content: [{ type: 'text', text: input }] }
        : input;

    // Augment message with skills if agent context is available
    const activatedSkillNames: string[] = [];
    const extendedContent: { type: 'text'; text: string }[] = [];

    if (this.agentContext) {
      const suffix = this.agentContext.getUserMessageSuffix(message, this.activatedSkillNames);
      if (suffix) {
        extendedContent.push(suffix.content);
        activatedSkillNames.push(...suffix.activatedSkillNames);
        this.activatedSkillNames.push(...suffix.activatedSkillNames);
      }
    }

    const event: MessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: message,
      ...(activatedSkillNames.length > 0 && { activated_skills: activatedSkillNames }),
      ...(extendedContent.length > 0 && { extended_content: extendedContent }),
    };
    this.events.push(event);
  }

  private emitToolError(toolCall: ToolCall, error: string): void {
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, error);
    this.events.push(agentErrorEvent);
    this.events.push(toolMessageEvent);
  }

  private parseToolArgs(toolCall: ToolCall): { args: Record<string, unknown>; securityRisk?: SecurityRisk } | undefined {
    const raw = toolCall.function.arguments;
    if (!raw) return { args: {} };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const { security_risk, ...rest } = parsed as Record<string, unknown>;
        return { args: rest, securityRisk: this.parseSecurityRisk(security_risk) };
      }
      throw new Error('Tool arguments must be a JSON object.');
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_args', toolName: toolCall.function.name, rawArgs: raw });
      this.emitToolError(toolCall, classified.message);
      return undefined;
    }
  }

  private parseSecurityRisk(value: unknown): SecurityRisk | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.toUpperCase() as SecurityRisk;
    return SECURITY_RISK_ORDER.includes(normalized) ? normalized : undefined;
  }

  private requiresConfirmation(action: ActionEvent): boolean {
    const policy = this.confirmation.policy ?? 'never';
    if (policy === 'never') return false;
    if (policy === 'always') return true;
    const risk = action.security_risk;
    if (!risk) return this.confirmation.confirmUnknown ?? true;
    const threshold = this.confirmation.riskyThreshold ?? 'MEDIUM';
    return SECURITY_RISK_ORDER.indexOf(risk) >= SECURITY_RISK_ORDER.indexOf(threshold);
  }

  private getRequiredWorkspaceAccess(
    toolName: string,
    args: Record<string, unknown>,
  ): { paths: string[] } | undefined {
    if (toolName !== 'file_editor') return undefined;
    const p = toOptionalNonEmptyString(args.path);
    if (!p || !path.isAbsolute(p)) return undefined;
    if (this.workspace.isPathAllowed(p)) return undefined;
    return { paths: [p] };
  }

  private createActionEvent(
    message: Message,
    toolCall: ToolCall,
    args: Record<string, unknown> | null,
    securityRisk?: SecurityRisk,
  ): ActionEvent {
    const thought = message.content.filter(isTextContent);
    return {
      kind: 'ActionEvent',
      source: 'agent',
      thought,
      reasoning_content: message.reasoning_content,
      action: args,
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      tool_call: toolCall,
      llm_response_id: message.id ?? randomUUID(),
      security_risk: securityRisk,
    };
  }

  private async executeTool(toolCall: ToolCall, actionEvent: ActionEvent, args: Record<string, unknown>): Promise<void> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      const available = Array.from(this.tools.keys());
      const errText = `Tool '${toolCall.function.name}' not found. Available: ${JSON.stringify(available)}`;
      const classified = classifyError(errText, { stage: 'tool_lookup', toolName: toolCall.function.name });
      this.emitToolError(toolCall, classified.message);
      throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
    }

    let validated;
    try {
      validated = tool.validate(args);
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_validation', toolName: tool.name, rawArgs: toolCall.function.arguments });
      this.emitToolError(toolCall, classified.message);
      throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
    }

    try {
      const context = { workspace: this.workspace, events: this.events, secrets: this.secrets };
      const result = await tool.execute(validated, context);

      if (toolCall.function.name === 'terminal') {
        this.emitTerminalEvents(toolCall, result);
      }

      const observation = {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: deepTruncate(this.maskSecretsInUnknown(result)) as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? randomUUID(),
      } as Event;
      this.events.push(observation);

      const formatted = this.formatToolMessageText(toolCall, result);
      const masked = this.maskSecretsInText(formatted);
      const clipped = truncateToolMessage(masked);

      const toolMessage: MessageEvent = {
        kind: 'MessageEvent',
        source: 'environment',
        llm_message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: [{ type: 'text', text: clipped }],
        },
      };
      this.events.push(toolMessage);

      await this.maybeSummarizeToolCall(toolCall, result);
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_execute', toolName: tool.name });
      if (classified.classification === 'agent') {
        // Treat execution failures as agent-visible errors so the LLM can self-correct.
        this.emitToolError(toolCall, classified.message);
        throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
      }
      throw new ClassifiedToolExecutionError({
        classification: 'conversation',
        message: classified.message,
        ...(classified.code ? { code: classified.code } : {}),
      });
    }
  }

  private emitTerminalEvents(toolCall: ToolCall, result: unknown): void {
    if (!this.options.onTerminalEvent) return;
    const payload = result as { command?: string; stdout?: string; stderr?: string; exitCode?: number };
    const commandId = toolCall.id;
    const timestamp = new Date().toISOString();
    const command = this.maskSecretsInText(payload.command ?? toolCall.function.arguments);
    const stdout = payload.stdout ? this.maskSecretsInText(payload.stdout) : null;
    const stderr = payload.stderr ? this.maskSecretsInText(payload.stderr) : null;
    const events: BashEvent[] = [
      {
        id: randomUUID(),
        type: 'BashCommand',
        timestamp,
        command_id: commandId,
        order: 0,
        command,
      },
      {
        id: randomUUID(),
        type: 'BashOutput',
        timestamp,
        command_id: commandId,
        order: 1,
        exit_code: payload.exitCode ?? 0,
        stdout,
        stderr,
      },
    ];
    events.forEach((evt) => this.options.onTerminalEvent?.(evt));
  }
}
