import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import { LLMStreamer } from './LLMStreamer';
import { AsyncLock } from './AsyncLock';
import { LlmClientCache } from './LlmClientCache';
import { ConversationState } from './ConversationState';
import { EventLog } from './EventLog';
import type { LLMClient, LLMProfileStoreOptions, LLMToolDefinition } from '../llm';
import {
  DEFAULT_PROVIDER_BASE_URLS,
  detectProviderFromBaseUrl,
  getEffectiveLlmConfigForCondensation as resolveCondensationLlmConfig,
  wouldExceedMaxInputTokens,
} from '../llm';
import type { ActionEvent, BashEvent, ConversationStateUpdateEvent, Event, Message, MessageEvent, ObservationEvent, TextContent, ToolCall } from '../types';
import {
  isActionEvent,
  isAgentErrorEvent,
  isObservationEvent,
  isPauseEvent,
  isSystemPromptEvent,
  isUserRejectObservation,
  type SecurityRisk,
} from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import type { BaseWorkspace } from '../../workspace';
import { Workspace } from '../../workspace';
import { FinishTool } from '../../tools/FinishTool';
import { ThinkTool } from '../../tools/ThinkTool';
import { SecretRegistry } from './SecretRegistry';
import type { AgentContext } from '../context';
import { createToolCallErrorEvents } from './toolCallErrorEvents';
import { classifyConversationErrorCode, ClassifiedToolExecutionError, classifyError } from './errorPolicy';
import { SYSTEM_PROMPT } from './systemPrompt';
import {
  redactAndTruncateArgs,
  sanitizeChatRequestForDebug,
  sanitizeMessageForDebug,
} from './textSanitizers';
import { formatToolMessageText } from './toolMessageFormatting';
import { toOptionalNonEmptyString } from './settingsUtils';
import { createLlmClientFromSettings as createLlmClientFromSettingsFromConfig } from './createLlmClientFromSettings';
import { deepTruncate, truncateToolMessage } from './toolResultTruncation';
import { SecretMasker } from './secretMasker';
import { ToolSummarizer } from './toolSummarizer';
import { buildChatRequestWithCondensation, tryCondenseConversation as tryCondenseConversationWithDeps } from './condensation';
import { buildConversationErrorDetail } from './conversationErrorDetail';
import { resolveSystemPromptLlmContext } from './systemPromptLlmContext';
import {
  resolveCondensationBudget,
  shouldRetryWithCondensationAfterError,
  shouldTryCondensationBeforeRequest,
} from './runLoopDecisions';
import { buildLlmRequestParametersForDebug } from '../llm/debug';
import { StuckDetector } from '../conversation/stuckDetector';
import type { ConfirmationPolicy, SecurityAnalyzer } from '../security';
import { createConfirmationPolicyFromSettings, LLMSecurityAnalyzer } from '../security';
import type { AgentHook, AfterToolCallHookParams, BeforeToolCallHookParams, BeforeToolCallHookResult, ShouldStopHookParams } from './hooks';


export type AgentRunInput = string | Message;
export type AgentRunOptions = {
  /**
   * Extra per-message extended content to attach to the user MessageEvent.
   * These are included in the LLM request (after the primary user text) and rendered
   * in the webview under “Extended Context”.
   */
  extraExtendedContent?: Array<{ type: 'text'; text: string }>;
};

export interface AgentOptions {
  settings: OpenHandsSettings;
  /**
   * Optional workspace instance. When omitted, the agent constructs a local workspace
   * rooted at workspaceRoot (or process.cwd()).
   */
  workspace?: BaseWorkspace;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  toolSummarizerClient?: LLMClient;
  /**
   * Controls whether the agent auto-registers builtin tools (e.g. FinishTool).
   *
   * - `false`: do not add any builtin tools automatically
   * - otherwise: preserve legacy behavior (auto-add FinishTool when missing)
   */
  includeDefaultTools?: boolean | string[];
  tools?: ToolDefinition<unknown, unknown>[];
  events?: EventLog;
  state?: ConversationState;
  secrets?: SecretRegistry;
  agentContext?: AgentContext;
  /**
   * Base directory for OpenHands-Tab persisted images (used to resolve `openhands-image://...` references
   * into data URLs for multimodal LLM requests).
   */
  pastedImagesBaseDir?: string;
  profileStoreOptions?: LLMProfileStoreOptions;
  onTerminalEvent?: (event: BashEvent) => void;
  registry?: import('../llm').LLMRegistry;
  conversationStats?: import('./ConversationStats').ConversationStats;
  confirmationPolicy?: ConfirmationPolicy;
  securityAnalyzer?: SecurityAnalyzer | null;
  hooks?: AgentHook | AgentHook[];
}

// Condensation is token-budget based (maxInputTokens). When the next request would exceed that
// budget (or the provider returns a context-limit error), we emit a `Condensation` event
// (summary + forgotten_event_ids). Future requests inject the summary and omit forgotten messages.
// Note: This fallback budget is intentionally set to 32k. We do not try to fall back below 32k
// because smaller budgets provide little practical value with modern LLM context windows.
const FALLBACK_CONDENSATION_MAX_INPUT_TOKENS = 32_000;
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

function requireToolArgsObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}


export class Agent extends EventEmitter {
  private readonly workspace: BaseWorkspace;
  private readonly events: EventLog;
  readonly state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly secretMasker: SecretMasker;
  private readonly tools: Map<string, ToolDefinition<unknown, unknown>>;
  private confirmationPolicyOverride?: ConfirmationPolicy;
  private confirmationPolicy: ConfirmationPolicy = createConfirmationPolicyFromSettings({ policy: 'never' });
  private securityAnalyzerOverride?: SecurityAnalyzer | null;
  private securityAnalyzer: SecurityAnalyzer | null = null;
  private readonly lock = new AsyncLock();
  private readonly llmClientCache: LlmClientCache<LLMStreamer>;
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
  private readonly hooks: AgentHook[];

  constructor(private readonly options: AgentOptions) {
    super();
    this.workspace = options.workspace ?? Workspace({ kind: 'local', root: options.workspaceRoot });
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
    const toolsWithBuiltins = (() => {
      if (options.includeDefaultTools === false) return providedTools;
      const names = new Set(providedTools.map((tool) => tool.name));
      const result = [...providedTools];
      if (!names.has('finish')) result.push(new FinishTool());
      if (!names.has('think')) result.push(new ThinkTool());
      return result;
    })();
    this.tools = new Map(toolsWithBuiltins.map((tool) => [tool.name, tool]));
    this.registry = options.registry;
    this.conversationStats = options.conversationStats;
    this.agentContext = options.agentContext;
    this.debug = false;
    this.hooks = Array.isArray(options.hooks) ? options.hooks : options.hooks ? [options.hooks] : [];
    this.llmClientCache = new LlmClientCache<LLMStreamer>({
      getInjectedClient: () => this.options.llmClient,
      createClient: () => this.createLlmClientFromSettings(),
      createStreamer: (client) => new LLMStreamer(client, { events: this.events, state: this.state }),
      emitDebugStateUpdate: (key, value) => this.emitDebugStateUpdate(key, value),
      getDebugContext: () => ({
        model: this.options.settings?.llm?.model ?? null,
        profileId: this.options.settings?.llm?.profileId ?? null,
      }),
    });

    if (options.confirmationPolicy) {
      this.confirmationPolicyOverride = options.confirmationPolicy;
    }
    if (options.securityAnalyzer !== undefined) {
      this.securityAnalyzerOverride = options.securityAnalyzer;
    }

    this.updateDerivedSettings(options.settings);

    this.events.on((event) => this.emit('event', event));
  }

  private async shouldStopByHooks(params: ShouldStopHookParams): Promise<boolean> {
    for (const hook of this.hooks) {
      if (!hook.shouldStop) continue;
      try {
        if (await hook.shouldStop(params)) {
          return true;
        }
      } catch {
        // Ignore hook failures to match Python SDK "hook results" semantics.
      }
    }
    return false;
  }

  private async runAfterEventHooks(event: Event): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.afterEvent) continue;
      try {
        await hook.afterEvent({ event });
      } catch {
        // Ignore hook failures to match Python SDK "hook results" semantics.
      }
    }
  }

  private async pushEventWithHooks<T extends Event>(event: T): Promise<T> {
    const recorded = this.events.push(event) as T;
    await this.runAfterEventHooks(recorded);
    return recorded;
  }

  private async runBeforeToolCallHooks(params: BeforeToolCallHookParams): Promise<BeforeToolCallHookResult> {
    let currentArgs = params.args;
    for (const hook of this.hooks) {
      if (!hook.beforeToolCall) continue;
      try {
        const result = await hook.beforeToolCall({ ...params, args: currentArgs });
        if (result && result.args) {
          currentArgs = result.args;
        }
      } catch {
        // Ignore hook failures to match Python SDK "hook results" semantics.
      }
    }
    if (currentArgs !== params.args) {
      return { args: currentArgs };
    }
    return undefined;
  }

  private async runAfterToolCallHooks(params: AfterToolCallHookParams): Promise<void> {
    for (const hook of this.hooks) {
      if (!hook.afterToolCall) continue;
      try {
        await hook.afterToolCall(params);
      } catch {
        // Ignore hook failures to match Python SDK "hook results" semantics.
      }
    }
  }

  private updateDerivedSettings(settings: OpenHandsSettings): void {
    const derivedConfirmationPolicy = createConfirmationPolicyFromSettings(settings?.confirmation);
    const derivedSecurityAnalyzer = settings?.agent?.enableSecurityAnalyzer ? new LLMSecurityAnalyzer() : null;

    this.confirmationPolicy = this.confirmationPolicyOverride ?? derivedConfirmationPolicy;
    this.securityAnalyzer =
      this.securityAnalyzerOverride !== undefined ? this.securityAnalyzerOverride : derivedSecurityAnalyzer;
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
   * Changes are applied under the agent lock so settings updates can't race with
   * an active run. New settings take effect on the next run.
   */
  setSettings(settings: OpenHandsSettings): void {
    const prevModel = this.options.settings?.llm?.model;
    const prevProfileId = this.options.settings?.llm?.profileId;
    void this.lock.acquire(() => {
      this.options.settings = settings;
      this.updateDerivedSettings(settings);

      // Force the next run to rebuild the LLM client from updated settings.
      this.llmClientCache.clear();

      // Debug logging for mid-run settings changes (oh-tab-rw1k)
      const newModel = settings?.llm?.model;
      const newProfileId = settings?.llm?.profileId;
      this.emitDebugStateUpdate('agent_settings_updated', {
        profile: { from: prevProfileId ?? null, to: newProfileId ?? null },
        model: { from: prevModel ?? null, to: newModel ?? null },
        cleared: { llmClientPromise: true, streamerPromise: true },
      });

      return Promise.resolve();
    });
  }

  setConfirmationPolicy(policy: ConfirmationPolicy): void {
    void this.lock.acquire(() => {
      this.confirmationPolicyOverride = policy;
      this.confirmationPolicy = policy;
      return Promise.resolve();
    });
  }

  setSecurityAnalyzer(analyzer: SecurityAnalyzer | null): void {
    void this.lock.acquire(() => {
      this.securityAnalyzerOverride = analyzer;
      this.securityAnalyzer = analyzer;
      return Promise.resolve();
    });
  }

  get pendingActionId(): string | undefined {
    return this.pendingAction?.actionEvent.id;
  }

  private emitRestorePendingConfirmationDiagnostic(reason: string, detail?: Record<string, unknown>): void {
    const event: ConversationStateUpdateEvent = {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      key: 'restore_pending_confirmation',
      value: { restored: false, reason, ...detail },
    };
    void this.pushEventWithHooks(event);
  }

  private emitDebugStateUpdate(key: string, value: unknown): void {
    if (!this.debug) return;
    const event: ConversationStateUpdateEvent = {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      key,
      value,
    };
    void this.pushEventWithHooks(event);
  }

  private clearWaitingForConfirmation(reason: string, detail?: Record<string, unknown>, emitError = false): void {
    this.emitRestorePendingConfirmationDiagnostic(reason, detail);
    if (emitError) {
      const lines = [
        'Pending confirmation could not be restored after reload; clearing WAITING_FOR_CONFIRMATION state.',
        `Reason: ${reason}`,
        detail ? `Context: ${JSON.stringify(detail)}` : undefined,
      ].filter(Boolean) as string[];
      void this.pushEventWithHooks({
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

  async run(input: AgentRunInput, options?: AgentRunOptions): Promise<Message | undefined> {
    this.cancelled = false;
    this.finished = false;
    this.paused = false;
    return this.lock.acquire(async () => {
      this.ensureSystemPrompt();
      this.pushUserMessage(input, { extraExtendedContent: options?.extraExtendedContent });
      return this.runLoop();
    });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    void this.pushEventWithHooks({ kind: 'PauseEvent', source: 'user' } as Event);
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
          await this.pushEventWithHooks(this.toConversationErrorEvent(error, { code: error.code, message: error.message }));
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
    void this.pushEventWithHooks({
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
    void this.pushEventWithHooks({
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
    void this.pushEventWithHooks({ kind: 'PauseEvent', source: 'agent' } as Event);
  }

  private isRunLoopBlocked(): boolean {
    return this.paused || Boolean(this.pendingAction) || this.cancelled || this.finished;
  }

  private shouldContinueRunLoop(maxIterations: number): boolean {
    return !this.isRunLoopBlocked() && this.state.snapshot.iteration < maxIterations;
  }

  private async emitMaxIterationsExceeded(maxIterations: number): Promise<void> {
    await this.pushEventWithHooks({
      kind: 'ConversationErrorEvent',
      source: 'agent',
      code: 'max_iterations_exceeded',
      detail: `Agent reached the maximum iteration limit (${maxIterations}). You can increase this limit in Settings > OpenHands > Conversation > Max Iterations and continue the conversation.`,
    });
    this.state.setStatus('IDLE');
  }

  private async ensureWithinIterationLimit(maxIterations: number): Promise<boolean> {
    if (this.state.snapshot.iteration < maxIterations) return true;
    await this.emitMaxIterationsExceeded(maxIterations);
    return false;
  }

  private async initializeStreamerForRunLoop(): Promise<LLMStreamer | undefined> {
    try {
      return await this.getStreamer();
    } catch (error) {
      const classified = classifyError(error, { stage: 'llm_init' });
      await this.pushEventWithHooks(this.toConversationErrorEvent(error, { code: classified.code }));
      this.state.setStatus('IDLE');
      // Allow a future retry after settings/secrets are updated.
      this.llmClientCache.clear();
      return undefined;
    }
  }

  private createStuckDetector(): StuckDetector | undefined {
    if (!this.options.settings?.conversation?.stuckDetection) return undefined;
    return new StuckDetector(this.options.settings?.conversation?.stuckThresholds ?? {});
  }

  private async shouldStopCurrentIteration(stuckDetector: StuckDetector | undefined): Promise<boolean> {
    if (await this.shouldStopByHooks({ state: this.state, events: this.events })) {
      this.state.setStatus('IDLE');
      return true;
    }

    if (!stuckDetector) return false;
    const stuck = stuckDetector.detect(this.events.list());
    if (!stuck.stuck) return false;

    await this.pushEventWithHooks({
      kind: 'ConversationErrorEvent',
      source: 'agent',
      code: 'stuck_detected',
      detail: stuck.reason ?? 'Agent appears to be stuck in a loop.',
    } as Event);
    this.state.setStatus('IDLE');
    return true;
  }

  private async tryCondenseConversation(maxInputTokens: number): Promise<boolean> {
    return tryCondenseConversationWithDeps({
      maxInputTokens,
      listEvents: () => this.events.list(),
      getPrimaryLlmClient: () => this.getPrimaryLlmClient(),
      pushEvent: (event) => this.pushEventWithHooks(event),
    });
  }

  private async requestAssistantResponse(
    streamer: LLMStreamer,
  ): Promise<Awaited<ReturnType<LLMStreamer['runChat']>> | undefined> {
    const llmConfig = resolveCondensationLlmConfig(this.options.settings);

    // Debug logging for mid-run settings tracking (oh-tab-rw1k)
    const currentModel = this.options.settings?.llm?.model;
    const currentProfileId = this.options.settings?.llm?.profileId;
    const hasStreamerPromise = this.llmClientCache.hasStreamerPromise();
    this.emitDebugStateUpdate('agent_run_loop_state', {
      iteration: this.state.snapshot.iteration,
      settings: {
        profileId: currentProfileId ?? null,
        model: currentModel ?? null,
      },
      cached: { streamerPromise: hasStreamerPromise },
    });

    // Condensation is token-budget based: before calling the LLM (and again if we hit a context-limit
    // error), we may summarize the conversation to shrink the next request.
    for (let condensationAttempt = 0; condensationAttempt <= MAX_CONDENSATIONS_PER_STEP; condensationAttempt += 1) {
      const request = buildChatRequestWithCondensation({
        events: this.events.list(),
        systemPrompt: this.buildSystemPrompt(),
        tools: this.getToolDefinitions(),
        pastedImagesBaseDir: this.options.pastedImagesBaseDir,
      });

      // Emit a lightweight debug/state event so hosts can log what tools are actually sent
      try {
        const toolNames = (request.tools ?? []).map((t) => t.function?.name).filter(Boolean);
        await this.pushEventWithHooks({
          kind: 'ConversationStateUpdateEvent',
          source: 'agent',
          key: 'llm_request',
          value: { model: this.options.settings?.llm?.model, tool_count: toolNames.length, tools: toolNames },
        } as Event);
      } catch (error) {
        if (this.debug) {
          console.warn('[Agent] Failed to emit llm_request debug event:', error);
          await this.pushEventWithHooks({
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
          await this.pushEventWithHooks({
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
      if (typeof configuredMaxInputTokens === 'number' && shouldTryCondensationBeforeRequest({
        attempt: condensationAttempt,
        maxAttempts: MAX_CONDENSATIONS_PER_STEP,
        requestExceedsTokenBudget: wouldExceedMaxInputTokens({ request, maxInputTokens: configuredMaxInputTokens }),
      })) {
        const condensed = await this.tryCondenseConversation(configuredMaxInputTokens);
        if (condensed) continue;
      }

      try {
        const result = await streamer.runChat(request);
        if (this.debug) {
          try {
            const provider = llmConfig.provider ?? detectProviderFromBaseUrl(llmConfig.baseUrl);
            const baseUrl = llmConfig.baseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider];
            await this.pushEventWithHooks({
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
        return result;
      } catch (error) {
        if (shouldRetryWithCondensationAfterError({
          attempt: condensationAttempt,
          maxAttempts: MAX_CONDENSATIONS_PER_STEP,
          llmProvider: llmConfig.provider,
          error,
        })) {
          const budget = resolveCondensationBudget(
            configuredMaxInputTokens,
            FALLBACK_CONDENSATION_MAX_INPUT_TOKENS,
          );
          const condensed = await this.tryCondenseConversation(budget);
          if (condensed) continue;
        }

        const provider = llmConfig.provider ?? detectProviderFromBaseUrl(llmConfig.baseUrl);
        const classified = classifyError(error, { stage: 'llm_request', llmProvider: provider });
        await this.pushEventWithHooks(this.toConversationErrorEvent(error, { code: classified.code }));
        this.state.setStatus('IDLE');
        return undefined;
      }
    }

    return undefined;
  }

  private async executeToolCallBatch(
    responseMessage: Message,
  ): Promise<'paused' | 'conversation_error' | 'finished' | 'failed' | 'completed'> {
    const toolCalls = responseMessage.tool_calls ?? [];
    let toolExecutionFailed = false;
    let finishedThisTurn = false;

    for (const toolCall of toolCalls) {
      // Log raw tool call for debugging visibility
      try {
        const rawArgs = toolCall.function?.arguments ?? '';
        const safeArgs = typeof rawArgs === 'string' ? redactAndTruncateArgs(rawArgs) : rawArgs;
        await this.pushEventWithHooks({
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
          await this.pushEventWithHooks({
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

      const actionEvent = this.createActionEvent(responseMessage, toolCall, args, securityRisk);
      const recordedAction = await this.pushEventWithHooks(actionEvent);

      if (finishedThisTurn) {
        await this.emitSkippedToolCall(toolCall, recordedAction, 'Skipped: finish tool already called in this run.');
        continue;
      }

      const workspaceAccess = this.getRequiredWorkspaceAccess(toolCall.function.name, actionArgs);
      if (workspaceAccess) {
        this.pauseForConfirmation({ toolCall, actionEvent: recordedAction, args: actionArgs }, workspaceAccess);
        return 'paused';
      }

      if (this.requiresConfirmation(recordedAction)) {
        this.pauseForConfirmation({ toolCall, actionEvent: recordedAction, args: actionArgs });
        return 'paused';
      }

      try {
        await this.executeTool(toolCall, recordedAction, actionArgs);
        if (toolCall.function.name === 'finish') {
          finishedThisTurn = true;
          this.finished = true;
        }
      } catch (error) {
        if (error instanceof ClassifiedToolExecutionError && error.classification === 'conversation') {
          await this.pushEventWithHooks(this.toConversationErrorEvent(error, { code: error.code, message: error.message }));
          this.state.setStatus('IDLE');
          return 'conversation_error';
        }
        toolExecutionFailed = true;
        // Continue processing other tool calls but mark this iteration as failed.
      }
    }

    if (finishedThisTurn) return 'finished';
    if (toolExecutionFailed) return 'failed';
    return 'completed';
  }

  private async processAssistantResponseStep(
    response: Awaited<ReturnType<LLMStreamer['runChat']>>,
    maxIterations: number,
  ): Promise<{ lastAssistantMessage: Message; returnEarly: boolean; stopLoop: boolean }> {
    const assistantEvent: MessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: response.message,
    };
    await this.pushEventWithHooks(assistantEvent);
    if (response.usage) {
      this.state.setValue('llm_usage', response.usage);
    }
    this.state.incrementIteration();
    const lastAssistantMessage = response.message;

    // Check if paused during streaming - don't execute tool calls.
    if (this.paused || this.cancelled) {
      return { lastAssistantMessage, returnEarly: false, stopLoop: true };
    }

    const toolCalls = response.message.tool_calls ?? [];
    if (!toolCalls.length) {
      this.state.setStatus('IDLE');
      return { lastAssistantMessage, returnEarly: false, stopLoop: true };
    }

    const batchResult = await this.executeToolCallBatch(response.message);
    if (batchResult === 'paused' || batchResult === 'conversation_error') {
      return { lastAssistantMessage, returnEarly: true, stopLoop: true };
    }
    if (batchResult === 'finished') {
      this.state.setStatus('IDLE');
      return { lastAssistantMessage, returnEarly: false, stopLoop: true };
    }
    if (batchResult === 'failed') {
      this.state.setStatus('IDLE');
      return { lastAssistantMessage, returnEarly: false, stopLoop: false };
    }

    if (!(await this.ensureWithinIterationLimit(maxIterations))) {
      return { lastAssistantMessage, returnEarly: false, stopLoop: true };
    }

    return { lastAssistantMessage, returnEarly: false, stopLoop: false };
  }

  private async runLoop(): Promise<Message | undefined> {
    if (this.isRunLoopBlocked()) return undefined;

    const maxIterations = this.clampMaxIterations();
    if (!(await this.ensureWithinIterationLimit(maxIterations))) return undefined;

    const streamer = await this.initializeStreamerForRunLoop();
    if (!streamer) return undefined;

    let lastAssistantMessage: Message | undefined;
    const stuckDetector = this.createStuckDetector();

    while (this.shouldContinueRunLoop(maxIterations)) {
      this.state.setStatus('RUNNING');

      if (await this.shouldStopCurrentIteration(stuckDetector)) break;

      const response = await this.requestAssistantResponse(streamer);
      if (!response) break;

      const stepResult = await this.processAssistantResponseStep(response, maxIterations);
      lastAssistantMessage = stepResult.lastAssistantMessage;
      if (stepResult.returnEarly) return lastAssistantMessage;
      if (stepResult.stopLoop) break;
    }

    return lastAssistantMessage;
  }

  private clampMaxIterations(): number {
    const raw = this.options.settings?.conversation?.maxIterations;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
    return Math.min(500, Math.max(1, n));
  }

  private getToolDefinitions(): LLMToolDefinition[] {
    const workspaceRoot = this.workspace.root;
    const definitions: LLMToolDefinition[] = Array.from(this.tools.values()).map((tool): LLMToolDefinition => {
      // Get base definition
      let baseDef: LLMToolDefinition;
      if (typeof tool.getToolDefinition === 'function') {
        baseDef = tool.getToolDefinition();
      } else {
        const definition: LLMToolDefinition['function'] = { name: tool.name };
        if (tool.description) {
          definition.description = tool.description;
        }
        if (tool.parameters) {
          definition.parameters = tool.parameters;
        }
        baseDef = { type: 'function', function: definition };
      }

      // Enhance description with workspace context if tool supports it
      if (typeof tool.getEnhancedDescription === 'function') {
        const enhancedDescription = tool.getEnhancedDescription(workspaceRoot);
        if (typeof enhancedDescription === 'string' && enhancedDescription.trim().length > 0) {
          return {
            ...baseDef,
            function: {
              ...baseDef.function,
              description: enhancedDescription,
            },
          };
        }
      }

      return baseDef;
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
          enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'],
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
      const { llmModel, llmProvider, llmBaseUrl } = resolveSystemPromptLlmContext(
        this.options.settings?.llm,
        this.options.profileStoreOptions,
      );
      const suffix = this.agentContext.getSystemMessageSuffix({
        secretNames: this.secrets.getRegisteredNames(),
        llmModel,
        llmProvider,
        llmBaseUrl,
      });
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
    return this.confirmationPolicy.kind !== 'NeverConfirm' || this.securityAnalyzer?.kind === 'LLMSecurityAnalyzer';
  }

  private async getPrimaryLlmClient(): Promise<LLMClient> {
    return this.llmClientCache.getPrimaryClient();
  }

  private async getStreamer(): Promise<LLMStreamer> {
    return this.llmClientCache.getStreamer();
  }

  private createLlmClientFromSettings(): Promise<LLMClient> {
    return createLlmClientFromSettingsFromConfig({
      settings: this.options.settings,
      secrets: this.secrets,
      profileStoreOptions: this.options.profileStoreOptions,
      registry: this.registry,
      conversationStats: this.conversationStats,
      state: this.state,
    });
  }

  private toConversationErrorEvent(error: unknown, options?: { code?: string; message?: string }): Event {
    const message = options?.message ?? stringifyErrorWithCause(error);
    const code = options?.code ?? classifyConversationErrorCode(message);
    const detail = buildConversationErrorDetail({
      message,
      debug: this.debug,
      settings: this.options.settings,
      profileStoreOptions: this.options.profileStoreOptions,
    });
    const maskedDetail = this.secretMasker.maskText(detail);
    return { kind: 'ConversationErrorEvent', source: 'agent', ...(code ? { code } : {}), detail: maskedDetail } as Event;
  }

  private ensureSystemPrompt() {
    const existing = this.events.list().find(isSystemPromptEvent);
    if (existing) return;

    const systemPrompt = this.buildSystemPrompt();
    void this.pushEventWithHooks({
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: systemPrompt },
      tools: this.getToolDefinitionsForEvent(),
    } as Event);
  }

  private pushUserMessage(input: AgentRunInput, options?: { extraExtendedContent?: Array<{ type: 'text'; text: string }> }) {
    const message: Message =
      typeof input === 'string'
        ? { role: 'user', content: [{ type: 'text', text: input }] }
        : input;

    // Augment message with skills if agent context is available
    const activatedSkillNames: string[] = [];
    const extendedContent: { type: 'text'; text: string }[] = [];

    const safeExtra = (options?.extraExtendedContent ?? [])
      .filter((c): c is { type: 'text'; text: string } => !!c && c.type === 'text' && typeof c.text === 'string' && c.text.length > 0)
      .map((c) => ({ type: 'text' as const, text: c.text }));
    if (safeExtra.length > 0) {
      extendedContent.push(...safeExtra);
    }

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
    void this.pushEventWithHooks(event);
  }

  private async emitToolError(toolCall: ToolCall, error: string): Promise<void> {
    const maskedError = this.secretMasker.maskText(error);
    const { agentErrorEvent, toolMessageEvent } = createToolCallErrorEvents(toolCall, maskedError);
    await this.pushEventWithHooks(agentErrorEvent);
    await this.pushEventWithHooks(toolMessageEvent);
  }

  private parseToolArgs(toolCall: ToolCall): { args: Record<string, unknown>; securityRisk?: SecurityRisk } | undefined {
    const raw = toolCall.function.arguments;
    if (!raw) return { args: {} };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const parsedObj = parsed as Record<string, unknown>;
        const { security_risk, ...rest } = parsedObj;
        const securityRisk = this.parseSecurityRisk(security_risk);

        if (this.securityAnalyzer?.kind === 'LLMSecurityAnalyzer' && toolCall.function.name !== 'finish') {
          if (security_risk === undefined) {
            throw new Error(`Missing required security_risk for tool '${toolCall.function.name}'.`);
          }
          if (!securityRisk) {
            const rawRisk =
              typeof security_risk === 'string'
                ? security_risk
                : (() => {
                    try {
                      return JSON.stringify(security_risk);
                    } catch {
                      return '[unserializable]';
                    }
                  })();
            throw new Error(`Invalid security_risk for tool '${toolCall.function.name}': ${rawRisk}`);
          }
        }

        return { args: rest, securityRisk };
      }
      throw new Error('Tool arguments must be a JSON object.');
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_args', toolName: toolCall.function.name, rawArgs: raw });
      void this.emitToolError(toolCall, classified.message);
      return undefined;
    }
  }

  private parseSecurityRisk(value: unknown): SecurityRisk | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.toUpperCase();
    if (normalized === 'UNKNOWN') return 'UNKNOWN';
    if (normalized === 'LOW') return 'LOW';
    if (normalized === 'MEDIUM') return 'MEDIUM';
    if (normalized === 'HIGH') return 'HIGH';
    return undefined;
  }

  private requiresConfirmation(action: ActionEvent): boolean {
    if (action.tool_name === 'finish') return false;
    let risk: SecurityRisk = 'UNKNOWN';
    if (this.securityAnalyzer) {
      try {
        risk = this.securityAnalyzer.securityRisk(action);
      } catch {
        risk = 'HIGH';
      }
    }
    if (risk === 'UNKNOWN') {
      risk = action.security_risk ?? 'UNKNOWN';
    }
    return this.confirmationPolicy.shouldConfirm(risk);
  }

  private async emitSkippedToolCall(toolCall: ToolCall, actionEvent: ActionEvent, reason: string): Promise<void> {
    const maskedReason = this.secretMasker.maskText(reason);
    const clipped = truncateToolMessage(maskedReason);
    await this.pushEventWithHooks({
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { skipped: true, reason: maskedReason },
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      action_id: actionEvent.id ?? randomUUID(),
    } as Event);
    await this.pushEventWithHooks({
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
    // Tool-call assistant messages are already emitted as MessageEvents (user-visible content).
    // Avoid duplicating that content in ActionEvent.thought, which the UI renders as "Reasoning".
    const thought: TextContent[] = [];
    const thinkingBlocks =
      message.thinking_signature && typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length
        ? [
            {
              type: 'thinking' as const,
              thinking: message.reasoning_content,
              signature: message.thinking_signature,
            },
          ]
        : [];
    const responsesReasoningItem =
      message.responses_reasoning_item
        ? {
            ...message.responses_reasoning_item,
            encrypted_content: undefined,
          }
        : null;
    // Use reasoning_content if available (Anthropic/OpenAI Chat Completions),
    // otherwise fall back to responses_reasoning_item.summary (OpenAI Responses API / GPT-5)
    const reasoningContent =
      message.reasoning_content ??
      (message.responses_reasoning_item?.summary?.length
        ? message.responses_reasoning_item.summary.join('\n\n')
        : undefined);
    return {
      kind: 'ActionEvent',
      source: 'agent',
      thought,
      reasoning_content: reasoningContent,
      thinking_blocks: thinkingBlocks,
      responses_reasoning_item: responsesReasoningItem,
      action: args,
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      tool_call: toolCall,
      llm_response_id: message.id ?? randomUUID(),
      security_risk: securityRisk ?? 'UNKNOWN',
    };
  }

  private async executeTool(toolCall: ToolCall, actionEvent: ActionEvent, args: Record<string, unknown>): Promise<void> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      const available = Array.from(this.tools.keys());
      const errText = `Tool '${toolCall.function.name}' not found. Available: ${JSON.stringify(available)}`;
      const classified = classifyError(errText, { stage: 'tool_lookup', toolName: toolCall.function.name });
      await this.emitToolError(toolCall, classified.message);
      throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
    }

    let validated: Record<string, unknown>;
    try {
      validated = requireToolArgsObject(tool.validate(args), `Validated args for tool '${tool.name}'`);
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_validation', toolName: tool.name, rawArgs: toolCall.function.arguments });
      await this.emitToolError(toolCall, classified.message);
      throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
    }

    try {
      if (this.hooks.length) {
        const hookResult = await this.runBeforeToolCallHooks({ toolCall, actionEvent, args: validated });
        if (hookResult && hookResult.args) {
          try {
            validated = requireToolArgsObject(tool.validate(hookResult.args), `Validated args for tool '${tool.name}'`);
          } catch (e) {
            const classified = classifyError(e, { stage: 'tool_validation', toolName: tool.name, rawArgs: toolCall.function.arguments });
            await this.emitToolError(toolCall, classified.message);
            await this.runAfterToolCallHooks({ toolCall, actionEvent, args: validated, error: classified.message });
            throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
          }
        }
      }

      const context = { workspace: this.workspace, events: this.events, secrets: this.secrets, settings: this.options.settings };
      const result = await tool.execute(validated, context);
      // Attach specialized summaries first (file diff, terminal), then general tool call summary as fallback
      let enrichedResult = await this.toolSummarizer.maybeAttachFileDiffSummary(toolCall, result);
      enrichedResult = await this.toolSummarizer.maybeAttachTerminalObservationSummary(toolCall, enrichedResult);
      enrichedResult = await this.toolSummarizer.maybeAttachToolCallSummary(toolCall, enrichedResult);

      if (toolCall.function.name === 'terminal') {
        this.emitTerminalEvents(toolCall, enrichedResult);
      }

      const observation: ObservationEvent = {
        kind: 'ObservationEvent',
        source: 'environment',
        observation: deepTruncate(this.secretMasker.maskUnknown(enrichedResult)) as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? randomUUID(),
      } as ObservationEvent;
      const recordedObservation = await this.pushEventWithHooks(observation);

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
      await this.pushEventWithHooks(toolMessage);

      await this.runAfterToolCallHooks({
        toolCall,
        actionEvent,
        args: validated,
        observationEvent: recordedObservation,
      });
    } catch (e) {
      const classified = classifyError(e, { stage: 'tool_execute', toolName: tool.name });
      if (classified.classification === 'agent') {
        // Treat execution failures as agent-visible errors so the LLM can self-correct.
        await this.emitToolError(toolCall, classified.message);
        await this.runAfterToolCallHooks({ toolCall, actionEvent, args: validated, error: classified.message });
        throw new ClassifiedToolExecutionError({ classification: 'agent', message: classified.message });
      }
      await this.runAfterToolCallHooks({ toolCall, actionEvent, args: validated, error: classified.message });
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
