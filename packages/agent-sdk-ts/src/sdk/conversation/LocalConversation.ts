import EventEmitter from 'events';
import {
  Agent,
  AsyncLock,
  ConversationState,
  ConversationStats,
  EventLog,
  FileStore,
  SecretRegistry,
  type PersistedLlmConfig,
} from '../runtime';
import type { LLMClient } from '../llm';
import type { BashEvent, Event } from '../types';
import { clearRawLlmFieldsWhenProfileSelected } from '../types/settings';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import type { BaseWorkspace } from '../../workspace';
import { Workspace } from '../../workspace';
import { LLMRegistry } from '../llm';
import type { RegistryEvent } from '../llm/registry';
import type { ConfirmationPolicy } from '../security/confirmationPolicy';
import type { SecurityAnalyzer } from '../security/analyzer';
import { FileEditorTool, TaskTrackerTool, TerminalTool } from '../../tools';
import type { SecretStorage } from 'vscode';
import path from 'path';
import type { ConversationPersistence } from '../runtime';
import { AgentContext } from '../context';
import type { AgentHook } from '../runtime/hooks';
import { resolveToolsWithDefaultTools } from './includeDefaultTools';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
  workspace?: BaseWorkspace;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  tools?: ToolDefinition<unknown, unknown>[];
  includeDefaultTools?: boolean | string[];
  secrets?: SecretRegistry;
  secretStorage?: SecretStorage;
  persistenceDir?: string;
  persistence?: ConversationPersistence;
  agentContext?: AgentContext;
  hooks?: AgentHook | AgentHook[];
}

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;
  private readonly workspace: BaseWorkspace;
  private events: EventLog;
  private state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly lock = new AsyncLock();
  private readonly customLlmClient?: LLMClient;
  private tools: ToolDefinition<unknown, unknown>[];
  private readonly includeDefaultTools?: boolean | string[];
  private readonly hasToolsOption: boolean;
  private readonly persistenceDir?: string;
  private persistence?: ConversationPersistence;
  private readonly agentContext?: AgentContext;
  private readonly hooks?: AgentHook | AgentHook[];
  private agent: Agent;
  private readonly llmRegistry: LLMRegistry;
  private readonly stats: ConversationStats;
  private hasUserMessage = false;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = options.workspace ?? Workspace({ kind: 'local', root: options.workspaceRoot });
    this.persistenceDir = options.persistenceDir;
    this.persistence = options.persistence;
    this.events = new EventLog({ persistence: this.persistence });
    this.state = new ConversationState({ eventLog: this.events, persistence: this.persistence });
    this.customLlmClient = options.llmClient;
    this.includeDefaultTools = options.includeDefaultTools;
    this.hasToolsOption = Object.prototype.hasOwnProperty.call(options, 'tools');
    this.tools = this.resolveTools(this.hasToolsOption ? (options.tools ?? []) : undefined);
    this.secrets = options.secrets ?? new SecretRegistry(options.secretStorage);
    this.agentContext = options.agentContext;
    this.hooks = options.hooks;
    this.llmRegistry = new LLMRegistry();
    this.stats = new ConversationStats();
    // connect registry to stats
    this.llmRegistry.subscribe((event: RegistryEvent) => this.stats.registerLlm(event));

    this.agent = this.createAgent();

    this.events.on((event) => this.emit('event', event));
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
    this.agent.setSettings(settings);
    this.persistLlmConfig();
  }

  getToolNames(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  setTools(tools: ToolDefinition<unknown, unknown>[]): void {
    if (this.hasUserMessage) {
      throw new Error('Cannot change tools after the conversation has started');
    }
    this.tools = this.resolveTools(tools);
    this.agent = this.createAgent();
  }

  startNewConversation(): Promise<string | undefined> {
    // Create a brand-new conversation id and fresh runtime (EventLog/State/Agent)
    this.conversationId = `local-${Date.now().toString(36)}`;
    this.hasUserMessage = false;

    // Reset persistence so a new store is created for the new id (if configured)
    this.persistence = undefined;

    // Clear the LLM registry so cached clients with stale metrics don't carry over
    this.llmRegistry.clear();

    // Reset stats so accumulated metrics from previous conversations don't carry over
    this.stats.clear();

    // Recreate logs/state
    this.events = new EventLog();
    this.state = new ConversationState({ eventLog: this.events });

    // Forward new event stream to listeners
    this.events.on((event) => this.emit('event', event));

    // Recreate agent bound to the fresh state/log
    this.agent = this.createAgent();

    // Online and persistence wiring for new conversation
    this.setStatus('online');
    this.initializePersistence();
    this.persistLlmConfig();
    this.state.persistSnapshot();

    this.emit('conversationStarted', this.conversationId);
    return Promise.resolve(this.conversationId);
  }

  restoreConversation(id: string) {
    // Switch to a new runtime bound to the requested conversation id
    this.conversationId = id;
    this.hasUserMessage = true;

    // If no persistence config exists at all, surface info and start fresh
    if (!this.persistenceDir && !this.persistence) {
      this.emit('error', new Error('Persistence is not configured; starting fresh session'));
      this.emit('conversationStarted', id);
      return;
    }

    try {
      // Fresh log/state and agent, and clear previous persistence
      this.persistence = undefined;
      this.events = new EventLog();
      this.state = new ConversationState({ eventLog: this.events });
      this.events.on((event) => this.emit('event', event));
      this.agent = this.createAgent();
      this.setStatus('online');

      // Wire persistence for this id and load
      const rootDir = this.persistenceDir
        ? (path.isAbsolute(this.persistenceDir) ? this.persistenceDir : path.join(this.workspace.root, this.persistenceDir))
        : this.workspace.root;
      const store = new FileStore({ rootDir, conversationId: id });
      this.persistence = store;
      this.events.attachPersistence(store);
      this.state.attachPersistence(store);
      this.restorePersistedLlmConfig(store);

      // Notify UI first so it clears any previous render before we stream restored events
      this.emit('conversationStarted', id);

      const loadedEvents = store.readEvents();
      if (loadedEvents.length) {
        this.events.replay(loadedEvents);
      }
      const snapshot = store.readState();
      if (snapshot) {
        this.state.restore(snapshot);
        const values: Record<string, unknown> = snapshot.values;
        const rawStats = values['stats'];
        if (rawStats) {
          const restored = ConversationStats.fromJSON(rawStats);
          this.stats.restore(restored);
        }
      } else {
        this.state.loadEvents(loadedEvents);
      }

      this.agent.restorePendingConfirmation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      this.events.push({
        kind: 'ConversationErrorEvent',
        source: 'environment',
        detail: err.message,
        code: 'restore_failed',
      } as Event);
      throw err;
    }
  }

  async sendUserMessage(text: string, options?: { run?: boolean }) {
    const run = options?.run !== false;
    await this.lock.acquire(async () => {
      if (!this.conversationId) {
        await this.startNewConversation();
      }
      this.hasUserMessage = true;

      if (!run) {
        this.events.push({
          kind: 'MessageEvent',
          source: 'user',
          llm_message: { role: 'user', content: [{ type: 'text', text }] },
        } as Event);
        return;
      }

      await this.agent.run(text);
    });
  }

  pause(): Promise<void> {
    this.agent.pause();
    return Promise.resolve();
  }

  async resume(): Promise<void> {
    await this.agent.resume();
  }

  setConfirmationPolicy(policy: ConfirmationPolicy): Promise<void> {
    this.agent.setConfirmationPolicy(policy);
    return Promise.resolve();
  }

  setSecurityAnalyzer(analyzer: SecurityAnalyzer | null): Promise<void> {
    this.agent.setSecurityAnalyzer(analyzer);
    return Promise.resolve();
  }

  approveAction(): Promise<void> {
    return this.agent.approveAction();
  }

  rejectAction(reason?: string): Promise<void> {
    this.agent.rejectAction(reason);
    return Promise.resolve();
  }

  disconnect() {
    this.setStatus('offline');
  }

  reconnect() {
    this.setStatus('online');
  }

  private setStatus(status: ConversationStatus) {
    this.status = status;
    this.emit('status', status);
  }

  private resolveTools(provided?: ToolDefinition<unknown, unknown>[]): ToolDefinition<unknown, unknown>[] {
    const defaultTools: ToolDefinition<unknown, unknown>[] = [
      new TerminalTool(),
      new FileEditorTool(),
      new TaskTrackerTool(),
    ];

    return resolveToolsWithDefaultTools({
      includeDefaultTools: this.includeDefaultTools,
      hasToolsOption: this.hasToolsOption,
      defaultTools,
      providedTools: provided,
    });
  }

  private createAgent(): Agent {
    return new Agent({
      settings: this.settings,
      workspace: this.workspace,
      llmClient: this.customLlmClient,
      tools: this.tools,
      includeDefaultTools: this.includeDefaultTools,
      events: this.events,
      state: this.state,
      secrets: this.secrets,
      agentContext: this.agentContext,
      hooks: this.hooks,
      onTerminalEvent: (event) => this.emit('terminal', event),
      registry: this.llmRegistry,
      conversationStats: this.stats,
    });
  }

  private initializePersistence() {
    if (!this.conversationId) return;

    if (this.persistence && this.persistence.conversationId !== this.conversationId) {
      throw new Error('Provided persistence does not match conversation id');
    }

    if (!this.persistenceDir) {
      if (this.persistence) {
        this.events.attachPersistence(this.persistence);
        this.state.attachPersistence(this.persistence);
      }
      return;
    }

    const rootDir = path.isAbsolute(this.persistenceDir)
      ? this.persistenceDir
      : path.join(this.workspace.root, this.persistenceDir);
    this.persistence = this.persistence ?? new FileStore({ rootDir, conversationId: this.conversationId });
    this.events.attachPersistence(this.persistence);
    this.state.attachPersistence(this.persistence);
  }

  private persistLlmConfig(): void {
    if (!this.conversationId) return;
    if (!this.persistence?.writeLlmConfig) return;

    const llm = this.settings.llm ?? {};
    const profileId = toOptionalNonEmptyString(llm.profileId);
    const model = toOptionalNonEmptyString(llm.model);
    const config: PersistedLlmConfig = {};
    if (profileId) {
      config.profileId = profileId;
    } else {
      if (llm.provider) config.provider = llm.provider;
      if (model) config.model = model;
    }

    const usageId = toOptionalNonEmptyString(llm.usageId);
    if (usageId) config.usageId = usageId;

    if (!profileId) {
      if (llm.openaiApiMode) config.openaiApiMode = llm.openaiApiMode;

      const baseUrl = toOptionalNonEmptyString(llm.baseUrl);
      if (baseUrl) config.baseUrl = baseUrl;
      const apiVersion = toOptionalNonEmptyString(llm.apiVersion);
      if (apiVersion) config.apiVersion = apiVersion;

      if (typeof llm.timeout === 'number' && Number.isFinite(llm.timeout)) config.timeoutSeconds = llm.timeout;
      if (typeof llm.temperature === 'number' && Number.isFinite(llm.temperature)) config.temperature = llm.temperature;
      if (typeof llm.topP === 'number' && Number.isFinite(llm.topP)) config.topP = llm.topP;
      if (typeof llm.topK === 'number' && Number.isFinite(llm.topK)) config.topK = llm.topK;
      if (typeof llm.maxInputTokens === 'number' && Number.isFinite(llm.maxInputTokens)) {
        config.maxInputTokens = llm.maxInputTokens;
      }
      if (typeof llm.maxOutputTokens === 'number' && Number.isFinite(llm.maxOutputTokens)) {
        config.maxOutputTokens = llm.maxOutputTokens;
      }

      if (llm.reasoningEffort) config.reasoningEffort = llm.reasoningEffort;
      if (llm.reasoningSummary) config.reasoningSummary = llm.reasoningSummary;

      if (typeof llm.inputCostPerToken === 'number' && Number.isFinite(llm.inputCostPerToken)) {
        config.inputCostPerToken = llm.inputCostPerToken;
      }
      if (typeof llm.outputCostPerToken === 'number' && Number.isFinite(llm.outputCostPerToken)) {
        config.outputCostPerToken = llm.outputCostPerToken;
      }
    }

    if (!Object.keys(config).length) return;
    this.persistence.writeLlmConfig(config);
  }

  private restorePersistedLlmConfig(store: ConversationPersistence): void {
    if (!store.readLlmConfig) return;
    const persisted = store.readLlmConfig();
    if (!persisted) return;
    if (!persisted.profileId && !persisted.model) return;

    const existing = this.settings.llm ?? {};
    const merged: OpenHandsSettings['llm'] = persisted.profileId
      ? clearRawLlmFieldsWhenProfileSelected({
        ...existing,
        profileId: persisted.profileId,
        usageId: persisted.usageId ?? undefined,
      })
      : {
        ...existing,
        profileId: undefined,
        provider: persisted.provider ?? undefined,
        model: persisted.model ?? undefined,
        usageId: persisted.usageId ?? undefined,
        openaiApiMode: persisted.openaiApiMode ?? undefined,
        baseUrl: persisted.baseUrl ?? undefined,
        apiVersion: persisted.apiVersion ?? undefined,
        timeout: persisted.timeoutSeconds ?? undefined,
        temperature: persisted.temperature ?? undefined,
        topP: persisted.topP ?? undefined,
        topK: persisted.topK ?? undefined,
        maxInputTokens: persisted.maxInputTokens ?? undefined,
        maxOutputTokens: persisted.maxOutputTokens ?? undefined,
        reasoningEffort: persisted.reasoningEffort ?? undefined,
        reasoningSummary: persisted.reasoningSummary ?? undefined,
        inputCostPerToken: persisted.inputCostPerToken ?? undefined,
        outputCostPerToken: persisted.outputCostPerToken ?? undefined,
      };

    this.settings = { ...this.settings, llm: merged };
    this.agent.setSettings(this.settings);
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
