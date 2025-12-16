import EventEmitter from 'events';
import { Agent, AsyncLock, ConversationState, EventLog, FileStore, SecretRegistry, ConversationStats } from '../runtime';
import type { LLMClient } from '../llm';
import type { BashEvent, Event } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';
import { LLMRegistry } from '../llm';
import type { RegistryEvent } from '../llm/registry';
import path from 'path';
import type { ConversationPersistence } from '../runtime';
import { AgentContext } from '../context';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  tools?: ToolDefinition<unknown, unknown>[];
  persistenceDir?: string;
  persistence?: ConversationPersistence;
  agentContext?: AgentContext;
}

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;
  private readonly workspace: LocalWorkspace;
  private events: EventLog;
  private state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly lock = new AsyncLock();
  private readonly customLlmClient?: LLMClient;
  private readonly tools: ToolDefinition<unknown, unknown>[];
  private readonly persistenceDir?: string;
  private persistence?: ConversationPersistence;
  private readonly agentContext?: AgentContext;
  private agent: Agent;
  private readonly llmRegistry: LLMRegistry;
  private readonly stats: ConversationStats;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.persistenceDir = options.persistenceDir;
    this.persistence = options.persistence;
    this.events = new EventLog({ persistence: this.persistence });
    this.state = new ConversationState({ eventLog: this.events, persistence: this.persistence });
    this.customLlmClient = options.llmClient;
    this.tools = options.tools ?? [];
    this.secrets = new SecretRegistry();
    this.agentContext = options.agentContext;
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
  }

  startNewConversation(): Promise<string | undefined> {
    // Create a brand-new conversation id and fresh runtime (EventLog/State/Agent)
    this.conversationId = `local-${Date.now().toString(36)}`;

    // Reset persistence so a new store is created for the new id (if configured)
    this.persistence = undefined;

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
    this.state.persistSnapshot();

    this.emit('conversationStarted', this.conversationId);
    return Promise.resolve(this.conversationId);
  }

  restoreConversation(id: string) {
    // Switch to a new runtime bound to the requested conversation id
    this.conversationId = id;

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

  async sendUserMessage(text: string) {
    await this.lock.acquire(async () => {
      if (!this.conversationId) {
        await this.startNewConversation();
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

  private createAgent(): Agent {
    return new Agent({
      settings: this.settings,
      workspaceRoot: this.workspace.root,
      llmClient: this.customLlmClient,
      tools: this.tools,
      events: this.events,
      state: this.state,
      secrets: this.secrets,
      agentContext: this.agentContext,
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
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
