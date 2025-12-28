import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import { LLMStreamer } from './LLMStreamer';
import { AsyncLock } from './AsyncLock';
import { ConversationState } from './ConversationState';
import { EventLog } from './EventLog';
import type { LLMClient, LLMProvider, LLMToolDefinition } from '../llm';
import {
  DEFAULT_PROVIDER_BASE_URLS,
  detectProviderFromBaseUrl,
  getEffectiveLlmConfigForCondensation as resolveCondensationLlmConfig,
  isContextLimitError,
  loadProfile,
  wouldExceedMaxInputTokens,
} from '../llm';
import type { ActionEvent, BashEvent, Event, Message, MessageEvent, ToolCall } from '../types';
import {
  isActionEvent,
  isAgentErrorEvent,
  isCondensation,
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
import { FinishTool } from '../../tools/FinishTool';
import { SecretRegistry } from './SecretRegistry';
import type { AgentContext } from '../context';
import { LLMSummarizingCondenser } from '../context';
import { createToolCallErrorEvents } from './toolCallErrorEvents';
import { classifyConversationErrorCode, ClassifiedToolExecutionError, classifyError } from './errorPolicy';
import { SYSTEM_PROMPT } from './systemPrompt';
import { sanitizeChatMessages } from './sanitizeChatMessages';
import {
  redactAndTruncateArgs,
  sanitizeChatRequestForDebug,
  sanitizeMessageForDebug,
} from './textSanitizers';
import { formatToolMessageText } from './toolMessageFormatting';
import { isSafeProfileId, toOptionalNonEmptyString } from './settingsUtils';
import { createLlmClientFromSettings as createLlmClientFromSettingsFromConfig } from './createLlmClientFromSettings';
import { deepTruncate, truncateToolMessage } from './toolResultTruncation';
import { SecretMasker } from './secretMasker';
import { ToolSummarizer } from './toolSummarizer';
import { buildLlmRequestParametersForDebug } from '../llm/debug';

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

const SECURITY_RISK_ORDER: SecurityRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

// Condensation is token-budget based (maxInputTokens). When the next request would exceed that
// budget (or the provider returns a context-limit error), we emit a `Condensation` event
// (summary + forgotten_event_ids). Future requests inject the summary and omit forgotten messages.
const FALLBACK_CONDENSATION_MAX_INPUT_TOKENS = 8_000;
const MAX_CONDENSATIONS_PER_STEP = 2;

const SECURITY_RISK_ASSESSMENT_SECTION = /\n?<SECURITY_RISK_ASSESSMENT>[\s\S]*?<\/SECURITY_RISK_ASSESSMENT>\n?/;

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


export class Agent extends EventEmitter {
  private readonly workspace: LocalWorkspace;
  private readonly events: EventLog;
  readonly state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly secretMasker: SecretMasker;
  private readonly tools: Map<string, ToolDefinition<unknown, unknown>>;
  private readonly confirmation: ConfirmationPolicy;
  private readonly lock = new AsyncLock();
  private llmClientPromise?: Promise<LLMClient>;
  private streamerPromise?: Promise<LLMStreamer>;
  private paused = false;
  private cancelled = false;
  private finished = false;
  private pendingAction?: { toolCall: ToolCall; actionEvent: ActionEvent; args: Record<string, unknown> };
  private pendingWorkspaceAccess?: { paths: string[] };
  private readonly agentContext?: AgentContext;
  private readonly activatedSkillNames: string[] = [];
  private readonly registry?: import('../llm').LLMRegistry;
  private readonly conversationStats?: import('./ConversationStats').ConversationStats;
  private debug: boolean;
  private readonly toolSummarizer: ToolSummarizer;
  /** Incremented each time setSettings() is called; used to detect mid-run changes. */
  private settingsVersion = 0;

  constructor(private readonly options: AgentOptions) {
    super();
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.events = options.events ?? new EventLog();
    this.state = options.state ?? new ConversationState({ eventLog: this.events });
    this.state.attachEventLog(this.events);
    this.secrets = options.secrets ?? new SecretRegistry();
    this.secretMasker = new SecretMasker({
      getConfiguredSecrets: () => Object.values(this.options.settings?.secrets ?? {}),
      getRegisteredSecrets: () => this.secrets.getRegisteredValues(),
    });
    this.toolSummarizer = new ToolSummarizer({
      secrets: this.secrets,
      secretMasker: this.secretMasker,
      injectedClient: options.toolSummarizerClient,
    });
    const providedTools = options.tools ?? [];
    const toolsWithFinish = providedTools.some((tool) => tool.name === 'finish')
      ? providedTools
      : [...providedTools, new FinishTool()];
    this.tools = new Map(toolsWithFinish.map((tool) => [tool.name, tool]));
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
    this.toolSummarizer.updateSettings(settings, { debug: this.debug });
    this.syncToolSecrets(settings);
  }

  private syncToolSecrets(settings: OpenHandsSettings): void {
    const s = settings?.secrets;
    this.secrets.set('GITHUB_TOKEN', s?.githubToken);
    this.secrets.set('CUSTOM_SECRET_1', s?.customSecret1);
    this.secrets.set('CUSTOM_SECRET_2', s?.customSecret2);
    this.secrets.set('CUSTOM_SECRET_3', s?.customSecret3);
    this.secrets.set('ELEVENLABS_API_KEY', s?.halTtsApiKey);
  }

  /**
   * Updates the agent's settings at runtime.
   *
   * Settings are applied immediately so the runLoop can detect changes mid-run
   * via settingsVersion and rebuild the LLM streamer if needed (e.g., when the
   * user switches LLM profiles).
   */
  setSettings(settings: OpenHandsSettings): void {
    // Increment version so runLoop can detect the change mid-run
    this.settingsVersion += 1;

    // Apply settings immediately for derived values (confirmation, debug, etc.)
    this.options.settings = settings;
    this.updateDerivedSettings(settings);

    // Force rebuild of LLM client/streamer on next use
    this.llmClientPromise = undefined;
    this.streamerPromise = undefined;
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
    this.finished = false;
    this.paused = false;
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
    const rejectionText = truncateToolMessage(this.secretMasker.maskText(`User rejected tool call: ${rejectionReason}`));
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
    if (this.paused || this.pendingAction || this.cancelled || this.finished) {
      return undefined;
    }

    const maxIterations = this.clampMaxIterations();
    let streamer: LLMStreamer;
    let streamerSettingsVersion = this.settingsVersion;
    try {
      streamer = await this.getStreamer();
    } catch (error) {
      const classified = classifyError(error, { stage: 'llm_init' });
      this.events.push(this.toConversationErrorEvent(error, { code: classified.code }));
      this.state.setStatus('IDLE');
      // Allow a future retry after settings/secrets are updated.
      this.llmClientPromise = undefined;
      this.streamerPromise = undefined;
      return undefined;
    }
    let lastAssistantMessage: Message | undefined;

    while (!this.paused && !this.pendingAction && !this.cancelled && !this.finished && this.state.snapshot.iteration < maxIterations) {
      // Check if settings changed mid-run (e.g., user switched LLM profile)
      if (this.settingsVersion !== streamerSettingsVersion) {
        try {
          streamer = await this.getStreamer();
          streamerSettingsVersion = this.settingsVersion;
        } catch (error) {
          const classified = classifyError(error, { stage: 'llm_init' });
          this.events.push(this.toConversationErrorEvent(error, { code: classified.code }));
          this.state.setStatus('IDLE');
          this.llmClientPromise = undefined;
          this.streamerPromise = undefined;
          return lastAssistantMessage;
        }
      }
      this.state.setStatus('RUNNING');
      const llmConfig = this.getEffectiveLlmConfigForCondensation();
      let response: Awaited<ReturnType<LLMStreamer['runChat']>> | undefined;

      // Condensation is token-budget based: before calling the LLM (and again if we hit a context-limit
      // error), we may summarize the conversation to shrink the next request.
      for (let condensationAttempt = 0; condensationAttempt <= MAX_CONDENSATIONS_PER_STEP; condensationAttempt += 1) {
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

        if (this.debug) {
          try {
            const provider = llmConfig.provider ?? detectProviderFromBaseUrl(llmConfig.baseUrl);
            const baseUrl = llmConfig.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider];
            const debugParameters = buildLlmRequestParametersForDebug({
              llmSettings: this.options.settings.llm,
              model: llmConfig.model,
            });
            this.events.push({
              kind: 'ConversationStateUpdateEvent',
              source: 'agent',
              key: 'llm_request_payload',
              value: {
                llm: {
                  provider,
                  model: llmConfig.model,
                  baseUrl,
                  ...(typeof llmConfig.openaiApiMode === 'string' ? { openaiApiMode: llmConfig.openaiApiMode } : {}),
                },
                request: sanitizeChatRequestForDebug(request, { parameters: debugParameters }),
              },
            } as Event);
          } catch (error) {
            console.warn('[Agent] Failed to emit llm_request_payload debug event:', error);
          }
        }

        const configuredMaxInputTokens = llmConfig.maxInputTokens;
        if (
          condensationAttempt < MAX_CONDENSATIONS_PER_STEP &&
          typeof configuredMaxInputTokens === 'number' &&
          wouldExceedMaxInputTokens({ request, maxInputTokens: configuredMaxInputTokens })
        ) {
          const condensed = await this.tryCondenseConversation({ maxInputTokens: configuredMaxInputTokens });
          if (condensed) continue;
        }

        try {
          const result = await streamer.runChat(request);
          response = result;
          if (this.debug) {
            try {
              const provider = llmConfig.provider ?? detectProviderFromBaseUrl(llmConfig.baseUrl);
              const baseUrl = llmConfig.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider];
              this.events.push({
                kind: 'ConversationStateUpdateEvent',
                source: 'agent',
                key: 'llm_response_payload',
                value: {
                  llm: {
                    provider,
                    model: llmConfig.model,
                    baseUrl,
                    ...(typeof llmConfig.openaiApiMode === 'string' ? { openaiApiMode: llmConfig.openaiApiMode } : {}),
                  },
                  response: {
                    message: sanitizeMessageForDebug(result.message),
                    usage: result.usage,
                  },
                },
              } as Event);
            } catch (error) {
              console.warn('[Agent] Failed to emit llm_response_payload debug event:', error);
            }
          }
          break;
        } catch (error) {
          if (condensationAttempt < MAX_CONDENSATIONS_PER_STEP && isContextLimitError(llmConfig.provider, error)) {
            const budget = configuredMaxInputTokens ?? FALLBACK_CONDENSATION_MAX_INPUT_TOKENS;
            const condensed = await this.tryCondenseConversation({ maxInputTokens: budget });
            if (condensed) continue;
          }

          const classified = classifyError(error, { stage: 'llm_request' });
          this.events.push(this.toConversationErrorEvent(error, { code: classified.code }));
          this.state.setStatus('IDLE');
          response = undefined;
          break;
        }
      }

      if (!response) break;

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

      // Check if paused during streaming - don't execute tool calls
      if (this.paused || this.cancelled) {
        break;
      }

      const toolCalls = response.message.tool_calls ?? [];
      if (!toolCalls.length) {
        this.state.setStatus('IDLE');
        break;
      }

      let toolExecutionFailed = false;
      let finishedThisTurn = false;
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

        if (finishedThisTurn) {
          this.emitSkippedToolCall(toolCall, recordedAction, 'Skipped: finish tool already called in this run.');
          continue;
        }

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
          if (toolCall.function.name === 'finish') {
            finishedThisTurn = true;
            this.finished = true;
          }
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

      if (finishedThisTurn) {
        this.state.setStatus('IDLE');
        break;
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

  /**
   * Build the next LLM request from the event log.
   *
   * Condensation is token-budget based: we inject the latest summary into the system prompt and
   * omit message events whose ids were marked forgotten by `Condensation` events.
   */
  private buildChatRequest() {
    const events = this.events.list();
    const condensationState = this.getCondensationState(events);

    let systemPrompt = this.buildSystemPrompt();
    if (condensationState.summary) {
      systemPrompt += `\n\n<CONVERSATION SUMMARY>\n${condensationState.summary}\n</CONVERSATION SUMMARY>`;
    }

    const rawMessages = events
      .filter(isMessageEvent)
      .filter((event) => !condensationState.forgottenEventIds.has(event.id ?? ''))
      .map((event) => {
        if (event.source === 'user' && event.extended_content?.length) {
          return { ...event.llm_message, content: [...event.llm_message.content, ...event.extended_content] };
        }
        return event.llm_message;
      });
    const messages = sanitizeChatMessages(rawMessages);
    const tools = this.getToolDefinitions();
    return { systemPrompt, messages, tools };
  }

  /**
   * Computes the current condensation state from the event log.
   *
   * Multiple condensations may occur over time; we keep the union of forgotten ids and the latest
   * non-empty summary.
   */
  private getCondensationState(events: Event[]): { summary: string | null; forgottenEventIds: Set<string>; summaryOffset: number | null } {
    const forgottenEventIds = new Set<string>();
    let summary: string | null = null;
    let summaryOffset: number | null = null;

    for (const event of events) {
      if (!isCondensation(event)) continue;
      for (const id of event.forgotten_event_ids ?? []) {
        if (typeof id === 'string' && id.trim()) forgottenEventIds.add(id);
      }
      if (typeof event.summary === 'string' && event.summary.trim()) {
        summary = event.summary.trim();
        const rawOffset = event.summary_offset;
        summaryOffset =
          typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : null;
      }
    }

    return { summary, forgottenEventIds, summaryOffset };
  }

  private getEffectiveLlmConfigForCondensation(): {
    provider: LLMProvider | undefined;
    baseUrl: string | undefined;
    model: string;
    openaiApiMode: unknown;
    maxInputTokens: number | undefined;
  } {
    return resolveCondensationLlmConfig(this.options.settings);
  }

  /**
   * Attempts to summarize the conversation so the next prompt fits within `maxInputTokens`.
   *
   * On success, emits a `Condensation` event containing a summary and the message event ids that
   * should be omitted from future requests.
   */
  private async tryCondenseConversation(params: { maxInputTokens: number }): Promise<boolean> {
    const maxInputTokens = Math.max(0, Math.trunc(params.maxInputTokens));
    if (maxInputTokens <= 0) return false;

    const events = this.events.list();
    const condensationState = this.getCondensationState(events);
    const condensableEvents = events
      .filter(isMessageEvent)
      .filter((event) => !condensationState.forgottenEventIds.has(event.id ?? ''));
    const previousSummary = condensationState.summary ?? '';

    let llm: LLMClient;
    try {
      llm = await this.getPrimaryLlmClient();
    } catch {
      return false;
    }

    const condenser = new LLMSummarizingCondenser(llm, { maxInputTokens });
    let result;
    try {
      result = await condenser.condense({ events: condensableEvents, previousSummary });
    } catch {
      return false;
    }

    if (!result?.summary) return false;
    if (!result.forgottenEventIds.length) return false;

    this.events.push({
      kind: 'Condensation',
      source: 'environment',
      forgotten_event_ids: result.forgottenEventIds,
      summary: result.summary,
      summary_offset: result.summaryOffset,
    } as Event);

    return true;
  }

  private getToolDefinitions(): LLMToolDefinition[] {
    const definitions: LLMToolDefinition[] = Array.from(this.tools.values()).map((tool): LLMToolDefinition => {
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

    if (!this.shouldIncludeSecurityRiskAssessment()) return definitions;

    return definitions.map((tool): LLMToolDefinition => {
      const fn = tool.function;
      if (fn.name === 'finish') return tool;
      const parameters =
        fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters)
          ? (fn.parameters as Record<string, unknown>)
          : {};
      const properties =
        parameters.properties && typeof parameters.properties === 'object' && !Array.isArray(parameters.properties)
          ? { ...(parameters.properties as Record<string, unknown>) }
          : {};

      if (!properties.security_risk) {
        properties.security_risk = {
          type: 'string',
          enum: ['LOW', 'MEDIUM', 'HIGH'],
          description: 'Assessed safety risk of this tool call.',
        };
      }

      const required = Array.isArray(parameters.required)
        ? parameters.required.filter((value): value is string => typeof value === 'string')
        : [];
      if (!required.includes('security_risk')) {
        required.unshift('security_risk');
      }

      return {
        ...tool,
        function: {
          ...fn,
          parameters: {
            ...parameters,
            type: 'object',
            properties,
            required,
          },
        },
      };
    });
  }

  private getToolDefinitionsForEvent(): Record<string, unknown>[] {
    return this.getToolDefinitions().map((tool) => tool as unknown as Record<string, unknown>);
  }

  private buildSystemPrompt(): string {
    let systemPrompt = SYSTEM_PROMPT;
    if (!this.shouldIncludeSecurityRiskAssessment()) {
      systemPrompt = systemPrompt.replace(SECURITY_RISK_ASSESSMENT_SECTION, '');
    }
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

  private shouldIncludeSecurityRiskAssessment(): boolean {
    const policy = this.confirmation.policy ?? 'never';
    return policy === 'always' || policy === 'risky';
  }

  private async getPrimaryLlmClient(): Promise<LLMClient> {
    if (this.options.llmClient) return this.options.llmClient;
    if (!this.llmClientPromise) {
      this.llmClientPromise = this.createLlmClientFromSettings();
    }
    return this.llmClientPromise;
  }

  private async getStreamer(): Promise<LLMStreamer> {
    if (!this.streamerPromise) {
      this.streamerPromise = (async () => {
        const client = await this.getPrimaryLlmClient();
        return new LLMStreamer(client, { events: this.events, state: this.state });
      })();
    }

    return this.streamerPromise;
  }

  private createLlmClientFromSettings(): Promise<LLMClient> {
    return createLlmClientFromSettingsFromConfig({
      settings: this.options.settings,
      secrets: this.secrets,
      registry: this.registry,
      conversationStats: this.conversationStats,
      state: this.state,
    });
  }

  private toConversationErrorEvent(error: unknown, options?: { code?: string; message?: string }): Event {
    const message = options?.message ?? stringifyErrorWithCause(error);
    const code = options?.code ?? classifyConversationErrorCode(message);
    const detail = (() => {
      if (!this.debug) return message;

      const model = toOptionalNonEmptyString(this.options.settings?.llm?.model);
      const profileId = toOptionalNonEmptyString(this.options.settings?.llm?.profileId);
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
      if (profileId) {
        contextParts.push(`llm.profileId=${profileId}`);

        if (isSafeProfileId(profileId)) {
          try {
            const profile = loadProfile(profileId);
            const profileModel = toOptionalNonEmptyString(profile.config.model);
            const profileBaseUrl = toOptionalNonEmptyString(profile.config.baseUrl);
            const effectiveProfileProvider =
              profile.config.provider ?? detectProviderFromBaseUrl(profileBaseUrl ?? configuredBaseUrl);
            contextParts.push(`llm.effectiveProvider=${effectiveProfileProvider}`);
            contextParts.push(`llm.effectiveModel=${profileModel ?? '(unset)'}`);
          } catch {
            // best-effort: profile may be missing or unreadable
          }
        }
      }
      if (serverUrl) contextParts.push(`serverUrl=${serverUrl}`);

      return `${message} (${contextParts.join(', ')})`;
    })();
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
    if (action.tool_name === 'finish') return false;
    const policy = this.confirmation.policy ?? 'never';
    if (policy === 'never') return false;
    if (policy === 'always') return true;
    const risk = action.security_risk;
    if (!risk) return this.confirmation.confirmUnknown ?? true;
    const threshold = this.confirmation.riskyThreshold ?? 'MEDIUM';
    return SECURITY_RISK_ORDER.indexOf(risk) >= SECURITY_RISK_ORDER.indexOf(threshold);
  }

  private emitSkippedToolCall(toolCall: ToolCall, actionEvent: ActionEvent, reason: string): void {
    const maskedReason = this.secretMasker.maskText(reason);
    const clipped = truncateToolMessage(maskedReason);
    this.events.push({
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { skipped: true, reason: maskedReason },
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      action_id: actionEvent.id ?? randomUUID(),
    } as Event);
    this.events.push({
      kind: 'MessageEvent',
      source: 'environment',
      llm_message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: [{ type: 'text', text: clipped }],
      },
    } as Event);
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
    // Use reasoning_content if available (Anthropic/OpenAI Chat Completions),
    // otherwise fall back to responses_reasoning_item.summary (OpenAI Responses API / GPT-5)
    const reasoningContent = message.reasoning_content
      ?? (message.responses_reasoning_item?.summary?.length
        ? message.responses_reasoning_item.summary.join('\n\n')
        : undefined);
    return {
      kind: 'ActionEvent',
      source: 'agent',
      thought,
      reasoning_content: reasoningContent,
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
      // Attach specialized summaries first (file diff, terminal), then general tool call summary as fallback
      let enrichedResult = await this.toolSummarizer.maybeAttachFileDiffSummary(toolCall, result);
      enrichedResult = await this.toolSummarizer.maybeAttachTerminalObservationSummary(toolCall, enrichedResult);
      enrichedResult = await this.toolSummarizer.maybeAttachToolCallSummary(toolCall, enrichedResult);

      if (toolCall.function.name === 'terminal') {
        this.emitTerminalEvents(toolCall, enrichedResult);
      }

      const observation = {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: deepTruncate(this.secretMasker.maskUnknown(enrichedResult)) as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? randomUUID(),
      } as Event;
      this.events.push(observation);

      // Remove summary from result before formatting for LLM - summaries are for UI display only
      const resultForLlm = (() => {
        if (enrichedResult && typeof enrichedResult === 'object' && !Array.isArray(enrichedResult) && 'summary' in enrichedResult) {
          const record = enrichedResult as Record<string, unknown>;
          const rest = { ...record };
          delete rest.summary;
          return rest;
        }
        return enrichedResult;
      })();

      const formatted = formatToolMessageText(toolCall, resultForLlm);
      const masked = this.secretMasker.maskText(formatted);
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
    const payload = result as { command?: string; stdout?: string; stderr?: string; exit_code?: number | null };
    const commandId = toolCall.id;
    const timestamp = new Date().toISOString();
    const command = this.secretMasker.maskText(payload.command ?? toolCall.function.arguments);
    const stdout = payload.stdout ? this.secretMasker.maskText(payload.stdout) : null;
    const stderr = payload.stderr ? this.secretMasker.maskText(payload.stderr) : null;
    const exitCode = typeof payload.exit_code === 'number' ? payload.exit_code : 0;
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
        exit_code: exitCode,
        stdout,
        stderr,
      },
    ];
    events.forEach((evt) => this.options.onTerminalEvent?.(evt));
  }
}
