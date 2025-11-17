import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type { SecretStorage } from 'vscode';
import { AgentOrchestrator, AsyncLock, ConversationState, EventLog, SecretRegistry } from '../runtime';
import { LLMFactory } from '../llm';
import type { LLMClient, LLMConfiguration, LLMToolDefinition } from '../llm';
import type { ActionEvent, BashEvent, Event, Message, MessageEvent, ToolCall } from '../types';
import { isTextContent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { BrowserTool, FileEditorTool, TaskTrackerTool, TerminalTool, type ToolHandler } from '../tools';
import { LocalWorkspace } from '../workspace/LocalWorkspace';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
  workspaceRoot?: string;
  llmClient?: LLMClient;
  secretStorage?: SecretStorage;
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
  private readonly tools: Map<string, ToolHandler<unknown, unknown>>;
  private readonly lock = new AsyncLock();
  private orchestratorPromise?: Promise<AgentOrchestrator>;
  private paused = false;
  private pendingAction?: { toolCall: ToolCall; actionEvent: ActionEvent; args: unknown };
  private readonly customLlmClient?: LLMClient;
  private readonly secretStorage?: SecretStorage;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.events = new EventLog();
    this.state = new ConversationState(this.events);
    this.secretStorage = options.secretStorage;
    this.customLlmClient = options.llmClient;
    this.secrets = new SecretRegistry(options.secretStorage);
    const providedTools = options.tools ?? [
      new TerminalTool(),
      new FileEditorTool(),
      new TaskTrackerTool(),
      new BrowserTool(),
    ];
    this.tools = new Map(providedTools.map((tool) => [tool.name, tool as ToolHandler<unknown, unknown>]));

    this.events.on((event) => this.emit('event', event));
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
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

      const userEvent: MessageEvent = {
        type: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text }] },
      };
      this.events.push(userEvent);

      await this.runAgentLoop();
    });
  }

  pause(): Promise<void> {
    this.paused = true;
    this.events.push({ type: 'PauseEvent', source: 'user' } as Event);
    this.state.setStatus('PAUSED');
    return Promise.resolve();
  }

  resume(): Promise<void> {
    this.paused = false;
    this.state.setStatus('RUNNING');
    return this.runAgentLoop();
  }

  approveAction(): Promise<void> {
    if (!this.pendingAction) return Promise.resolve();
    return this.lock.acquire(async () => {
      const { toolCall, actionEvent, args } = this.pendingAction!;
      this.pendingAction = undefined;
      this.state.setStatus('RUNNING');
      await this.executeTool(toolCall, actionEvent, args);
      await this.runAgentLoop();
    });
  }

  rejectAction(reason?: string): Promise<void> {
    if (!this.pendingAction) return Promise.resolve();
    const { actionEvent } = this.pendingAction;
    this.pendingAction = undefined;
    const rejection = {
      type: 'UserRejectObservation',
      source: 'environment',
      rejection_reason: reason ?? 'User rejected the action',
      tool_name: actionEvent.tool_name,
      tool_call_id: actionEvent.tool_call_id,
      action_id: actionEvent.id!,
    } as Event;
    this.events.push(rejection);
    this.state.setStatus('IDLE');
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

  private async runAgentLoop(): Promise<void> {
    if (this.paused || this.pendingAction) {
      return;
    }

    const maxIterations = this.clampMaxIterations();
    const orchestrator = await this.getOrchestrator();

    while (!this.paused && !this.pendingAction && this.state.snapshot.iteration < maxIterations) {
      this.state.setStatus('RUNNING');
      const request = this.buildChatRequest();
      const response = await orchestrator.runChat(request);

      const assistantEvent: MessageEvent = {
        type: 'MessageEvent',
        source: 'agent',
        llm_message: response.message,
      };
      this.events.push(assistantEvent);
      this.state.incrementIteration();

      const toolCalls = response.message.tool_calls ?? [];
      if (!toolCalls.length) {
        this.state.setStatus('IDLE');
        break;
      }

      for (const toolCall of toolCalls) {
        const parsedArgs = this.parseToolArgs(toolCall.function.arguments);
        const actionEvent = this.createActionEvent(response.message, toolCall, parsedArgs);
        const recordedAction = this.events.push(actionEvent) as ActionEvent;

        if (this.requiresConfirmation()) {
          this.pendingAction = { toolCall, actionEvent: recordedAction, args: parsedArgs };
          this.state.setStatus('WAITING_FOR_CONFIRMATION');
          return;
        }

        await this.executeTool(toolCall, recordedAction, parsedArgs);
      }
    }
  }

  private clampMaxIterations(): number {
    const raw = this.settings?.conversation?.maxIterations;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
    return Math.min(500, Math.max(1, n));
  }

  private buildChatRequest() {
    const systemPrompt = 'You are OpenHands, an autonomous AI agent running inside VS Code.';
    const messages = this.events
      .list()
      .filter((event): event is MessageEvent => event.type === 'MessageEvent')
      .map((event) => event.llm_message);
    const tools = this.getToolDefinitions();
    return { systemPrompt, messages, tools };
  }

  private getToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: { name: tool.name },
    }));
  }

  private async getOrchestrator(): Promise<AgentOrchestrator> {
    if (!this.orchestratorPromise) {
      this.orchestratorPromise = (async () => {
        const client = this.customLlmClient ?? (await this.createLlmClientFromSettings());
        return new AgentOrchestrator(client, { events: this.events, state: this.state });
      })();
    }

    return this.orchestratorPromise;
  }

  private createLlmClientFromSettings(): Promise<LLMClient> {
    if (!this.settings.llm?.model) {
      return Promise.reject(new Error('LLM model is not configured'));
    }
    const s = this.settings;
    const config: LLMConfiguration = {
      model: s.llm.model ?? '',
      baseUrl: s.llm.baseUrl ?? undefined,
      apiKey: s.secrets?.llmApiKey ?? undefined,
      apiVersion: s.llm.apiVersion ?? undefined,
      timeoutSeconds: s.llm.timeout ?? undefined,
      temperature: s.llm.temperature ?? undefined,
      topP: s.llm.topP ?? undefined,
      topK: s.llm.topK ?? undefined,
      maxInputTokens: s.llm.maxInputTokens ?? undefined,
      maxOutputTokens: s.llm.maxOutputTokens ?? undefined,
      nativeToolCalling: s.llm.nativeToolCalling ?? undefined,
      reasoningEffort: s.llm.reasoningEffort ?? undefined,
    };
    const factory = new LLMFactory(config, { storage: this.secretStorage });
    return factory.createClient();
  }

  private parseToolArgs(raw: string | undefined): unknown {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      this.events.push({
        type: 'AgentErrorEvent',
        source: 'agent',
        error: `Invalid tool arguments: ${e instanceof Error ? e.message : String(e)}`,
        tool_name: 'unknown',
        tool_call_id: randomUUID(),
      } as Event);
      return {};
    }
  }

  private requiresConfirmation(): boolean {
    const policy = this.settings?.confirmation?.policy ?? 'never';
    return policy !== 'never';
  }

  private createActionEvent(message: Message, toolCall: ToolCall, args: unknown): ActionEvent {
    const thought = message.content.filter(isTextContent);
    return {
      type: 'ActionEvent',
      source: 'agent',
      thought,
      reasoning_content: message.reasoning_content,
      action: typeof args === 'object' ? (args as Record<string, unknown>) : null,
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      tool_call: toolCall,
      llm_response_id: message.id ?? randomUUID(),
    };
  }

  private async executeTool(toolCall: ToolCall, actionEvent: ActionEvent, args: unknown): Promise<void> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      this.events.push({
        type: 'AgentErrorEvent',
        source: 'agent',
        error: `Unknown tool: ${toolCall.function.name}`,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      } as Event);
      return;
    }

    try {
      const validated = tool.validate(args);
      const context = { workspace: this.workspace, events: this.events, secrets: this.secrets };
      const result = await tool.execute(validated as never, context);

      if (toolCall.function.name === 'terminal') {
        this.emitTerminalEvents(toolCall, result);
      }

      const observation = {
        type: 'ObservationEvent',
        source: 'environment',
        observation: result as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? randomUUID(),
      } as Event;
      this.events.push(observation);

      const toolMessage: MessageEvent = {
        type: 'MessageEvent',
        source: 'environment',
        llm_message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        },
      };
      this.events.push(toolMessage);
    } catch (e) {
      this.events.push({
        type: 'AgentErrorEvent',
        source: 'agent',
        error: e instanceof Error ? e.message : String(e),
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      } as Event);
    }
  }

  private emitTerminalEvents(toolCall: ToolCall, result: unknown): void {
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
    events.forEach((evt) => this.emit('terminal', evt));
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
