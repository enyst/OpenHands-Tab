import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import { AgentOrchestrator } from './AgentOrchestrator';
import { AsyncLock } from './AsyncLock';
import { ConversationState } from './ConversationState';
import { EventLog } from './EventLog';
import type { LLMClient, LLMToolDefinition } from '../llm';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl, LLMFactory } from '../llm';
import type { ActionEvent, BashEvent, Event, Message, MessageEvent, ToolCall } from '../types';
import { isMessageEvent, isSystemPromptEvent, isTextContent, type SecurityRisk } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';
import { SecretRegistry } from './SecretRegistry';
import type { AgentContext } from '../context';
import { createToolCallErrorEvents } from './toolCallErrorEvents';

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
const TOOL_MESSAGE_MAX_CHARS = 8_000;
const TOOL_MESSAGE_CLIP_MARKER = '<response clipped>';
function truncateString(input: string): string {
  return input.length > TRUNCATE_LIMIT ? input.slice(0, TRUNCATE_LIMIT) + ELLIPSIS : input;
}
function deepTruncate(value: unknown): unknown {
  if (typeof value === 'string') return truncateString(value);
  if (Array.isArray(value)) return value.map((v) => deepTruncate(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepTruncate(v);
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

function truncateToolMessage(text: string, maxChars = TOOL_MESSAGE_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const available = maxChars - TOOL_MESSAGE_CLIP_MARKER.length - 2;
  const half = Math.max(0, Math.floor(available / 2));
  const head = text.slice(0, half);
  const tail = text.slice(-half);
  return `${head}\n${TOOL_MESSAGE_CLIP_MARKER}\n${tail}`;
}

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
  }

  private getSecretValuesForMasking(): string[] {
    const values = new Set<string>();
    const maybePush = (candidate: unknown) => {
      if (typeof candidate !== 'string') return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      if (/^[A-Z0-9_]+$/.test(trimmed)) {
        const envValue = process.env[trimmed];
        if (envValue) values.add(envValue);
      } else {
        values.add(trimmed);
      }
    };

    for (const secret of Object.values(this.options.settings?.secrets ?? {})) {
      maybePush(secret);
    }

    for (const secret of this.secrets.getRegisteredValues()) {
      maybePush(secret);
    }

    const envKeyLooksSensitive = /(?:^|_)(?:API_?KEY|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD)(?:$|_)/i;
    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue;
      if (!envKeyLooksSensitive.test(key)) continue;
      values.add(value);
    }

    return Array.from(values)
      .filter((value) => value.length >= 8)
      .sort((a, b) => b.length - a.length);
  }

  private maskSecretsInText(text: string): string {
    let masked = text;
    for (const secret of this.getSecretValuesForMasking()) {
      masked = masked.replaceAll(secret, '***');
    }
    return redactStringHeuristics(masked);
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
      const header = targetPath
        ? `file_editor${command ? ` ${command}` : ''} ${targetPath}`
        : `file_editor${command ? ` ${command}` : ''}`;
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
      await this.executeTool(pending.toolCall, pending.actionEvent, pending.args);
      await this.runLoop();
    });
  }

  rejectAction(reason?: string): void {
    if (!this.pendingAction) return;
    const { actionEvent, toolCall } = this.pendingAction;
    this.pendingAction = undefined;
    this.pendingWorkspaceAccess = undefined;
    this.events.push({
      kind: 'UserRejectObservation',
      source: 'environment',
      rejection_reason: reason ?? 'User rejected the action',
      tool_name: actionEvent.tool_name,
      tool_call_id: toolCall.id,
      action_id: actionEvent.id!,
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
      this.events.push(this.toConversationErrorEvent(error));
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
        this.events.push(this.toConversationErrorEvent(error));
        this.state.setStatus('IDLE');
        break;
      }

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
        } catch {
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
    const messages = this.events
      .list()
      .filter(isMessageEvent)
      .map((event) => event.llm_message);
    const tools = this.getToolDefinitions();
    return { systemPrompt, messages, tools };
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
      const suffix = this.agentContext.getSystemMessageSuffix();
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
    if (!this.options.settings.llm?.model) {
      return Promise.reject(new Error('LLM model is not configured'));
    }
    const s = this.options.settings;
    const config = {
      provider: s.llm.provider ?? undefined,
      model: s.llm.model ?? '',
      usageId: s.llm.usageId ?? undefined,
      baseUrl: s.llm.baseUrl ?? undefined,
      apiKey: s.secrets?.llmApiKey ?? undefined,
      apiVersion: s.llm.apiVersion ?? undefined,
      timeoutSeconds: s.llm.timeout ?? undefined,
      temperature: s.llm.temperature ?? undefined,
      topP: s.llm.topP ?? undefined,
      topK: s.llm.topK ?? undefined,
      maxInputTokens: s.llm.maxInputTokens ?? undefined,
      maxOutputTokens: s.llm.maxOutputTokens ?? undefined,
      reasoningEffort: s.llm.reasoningEffort ?? undefined,
      inputCostPerToken: s.llm.inputCostPerToken ?? undefined,
      outputCostPerToken: s.llm.outputCostPerToken ?? undefined,
    };
    const factory = new LLMFactory(config, {
      secrets: this.secrets,
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

  private toConversationErrorEvent(error: unknown): Event {
    const message = stringifyErrorWithCause(error);
    const code = this.classifyConversationError(message);
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

  private classifyConversationError(message: string): string | undefined {
    if (message.includes('Missing API key for LLM provider')) return 'missing_llm_api_key';
    if (message.includes('LLM model is not configured')) return 'llm_model_not_configured';
    if (message.startsWith('LLM request failed')) return 'llm_request_failed';
    return undefined;
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
      const errText = `Error validating args ${raw} for tool '${toolCall.function.name}': ${e instanceof Error ? e.message : String(e)}`;
      this.emitToolError(toolCall, errText);
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
      this.emitToolError(toolCall, errText);
      throw new Error(errText);
    }

    let validated;
    try {
      validated = tool.validate(args);
    } catch (e) {
      const errText = `Error validating args ${toolCall.function.arguments} for tool '${tool.name}': ${e instanceof Error ? e.message : String(e)}`;
      this.emitToolError(toolCall, errText);
      throw new Error(errText);
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
        observation: deepTruncate(result) as Record<string, unknown>,
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
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      // Treat execution failures as agent-visible errors so the LLM can self-correct
      this.emitToolError(toolCall, errText);
      throw e;
    }
  }

  private emitTerminalEvents(toolCall: ToolCall, result: unknown): void {
    if (!this.options.onTerminalEvent) return;
    const payload = result as { command?: string; stdout?: string; stderr?: string; exitCode?: number };
    const commandId = toolCall.id;
    const timestamp = new Date().toISOString();
    const events: BashEvent[] = [
      {
        id: randomUUID(),
        type: 'BashCommand',
        timestamp,
        command_id: commandId,
        order: 0,
        command: payload.command ?? toolCall.function.arguments,
      },
      {
        id: randomUUID(),
        type: 'BashOutput',
        timestamp,
        command_id: commandId,
        order: 1,
        exit_code: payload.exitCode ?? 0,
        stdout: payload.stdout ?? null,
        stderr: payload.stderr ?? null,
      },
    ];
    events.forEach((evt) => this.options.onTerminalEvent?.(evt));
  }
}
