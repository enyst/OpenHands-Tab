import EventEmitter from 'events';
import { Agent, AsyncLock, ConversationState, EventLog, SecretRegistry } from '../runtime';
import type { LLMClient } from '../llm';
import type { BashEvent, Event } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolHandler } from '../types/tools';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  tools?: ToolHandler<unknown, unknown>[];
}

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;
  private readonly workspace: LocalWorkspace;
  private readonly events: EventLog;
  private readonly state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly lock = new AsyncLock();
  private readonly customLlmClient?: LLMClient;
  private readonly tools: ToolHandler<unknown, unknown>[];
  private agent: Agent;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.events = new EventLog();
    this.state = new ConversationState(this.events);
    this.customLlmClient = options.llmClient;
    this.tools = options.tools ?? [];
    this.secrets = new SecretRegistry();
    this.agent = this.createAgent();

    this.events.on((event) => this.emit('event', event));
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
    this.agent = this.createAgent();
  }

  startNewConversation(): Promise<string | undefined> {
    this.conversationId = this.conversationId ?? `local-${Date.now().toString(36)}`;
    this.emit('conversationStarted', this.conversationId);
    return Promise.resolve(this.conversationId);
  }

  restoreConversation(id: string) {
    this.conversationId = id;
    this.emit('conversationStarted', id);
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
      onTerminalEvent: (event) => this.emit('terminal', event),
    });
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
