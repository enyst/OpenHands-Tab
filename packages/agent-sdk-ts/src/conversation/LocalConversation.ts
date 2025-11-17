import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type { SecretStorage } from 'vscode';
import { AgentOrchestrator, ConversationState, EventLog, SecretRegistry } from '../runtime';
import { LLMFactory } from '../llm';
import type { LLMClient, LLMToolDefinition } from '../llm';
import type {
  ActionEvent,
  BashEvent,
  ConversationStateUpdateEvent,
  Event,
  MessageEvent,
  ObservationEvent,
  ToolCall,
  UserRejectObservation,
} from '../types';
import { isTextContent } from '../types';
import type { Message } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { BrowserTool, FileEditorTool, TaskTrackerTool, TerminalTool, type ToolHandler } from '../tools';
import type { TerminalResult } from '../tools/TerminalTool';
import { LocalWorkspace } from '../workspace/LocalWorkspace';
import type { ToolContext } from '../tools/types';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  workspaceRoot?: string;
  storage?: SecretStorage;
  conversationId?: string;
  llmClient?: LLMClient; // primarily for tests
}

type PendingAction = {
  actionEvent: ActionEvent;
  handler: ToolHandler<unknown, unknown>;
  args: unknown;
  toolCall: ToolCall;
};

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;
  private readonly workspace: LocalWorkspace;
  private readonly secrets: SecretRegistry;
  private readonly storage?: SecretStorage;
  private readonly events: EventLog;
  private readonly state: ConversationState;
  private orchestrator?: AgentOrchestrator;
  private readonly toolContext: ToolContext;
  private readonly tools: Record<string, ToolHandler<unknown, unknown>>;
  private readonly toolDefinitions: LLMToolDefinition[];
  private readonly messages: Message[] = [];
  private pendingActions: PendingAction[] = [];
  private awaitingConfirmation = false;
  private paused = false;
  private runningPromise: Promise<void> | null = null;
  private readonly iterationLimit: number;
  private readonly systemPrompt =
    'You are OpenHands running locally inside VS Code. Use the available tools to complete tasks. Return concise updates when no action is needed.';

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.secrets = new SecretRegistry(options.storage);
    this.storage = options.storage;
    this.events = new EventLog();
    this.state = new ConversationState(this.events);
    this.toolContext = { workspace: this.workspace, events: this.events, secrets: this.secrets };
    if (this.settings.secrets?.llmApiKey) this.secrets.register('LLM_API_KEY', this.settings.secrets.llmApiKey);
    if (this.settings.secrets?.awsAccessKeyId) this.secrets.register('AWS_ACCESS_KEY_ID', this.settings.secrets.awsAccessKeyId);
    if (this.settings.secrets?.awsSecretAccessKey) {
      this.secrets.register('AWS_SECRET_ACCESS_KEY', this.settings.secrets.awsSecretAccessKey);
    }
    this.tools = {
      terminal: new TerminalTool(),
      file_editor: new FileEditorTool(),
      task_tracker: new TaskTrackerTool(),
      browser: new BrowserTool(),
    };
    this.toolDefinitions = this.buildToolDefinitions();
    this.iterationLimit = this.clampIterations(options.settings.conversation?.maxIterations);

    if (options.llmClient) {
      this.orchestrator = new AgentOrchestrator(options.llmClient, { events: this.events, state: this.state });
    }

    this.events.on((event) => this.emit('event', event));
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
  }

  async startNewConversation(): Promise<string | undefined> {
    this.resetConversation();
    this.conversationId = this.conversationId ?? `local-${Date.now().toString(36)}`;
    this.emit('conversationStarted', this.conversationId);
    return this.conversationId;
  }

  restoreConversation(id: string) {
    this.resetConversation();
    this.conversationId = id;
    this.emit('conversationStarted', id);
  }

  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      await this.startNewConversation();
    }

    const userMessage: Message = { role: 'user', content: [{ type: 'text', text }] };
    this.messages.push(userMessage);
    this.pushEvent({
      type: 'MessageEvent',
      source: 'user',
      llm_message: userMessage,
    });

    await this.runAgentLoop();
  }

  async pause(): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    this.state.setStatus('paused');
    this.pushEvent({ type: 'PauseEvent', source: 'user' });
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    this.state.setStatus('running');
    await this.runAgentLoop();
  }

  async approveAction(): Promise<void> {
    if (!this.awaitingConfirmation || this.pendingActions.length === 0) return;
    const actions = [...this.pendingActions];
    this.pendingActions = [];
    this.awaitingConfirmation = false;

    for (const pending of actions) {
      await this.executeToolCall(pending.handler, pending.args, pending.toolCall, pending.actionEvent);
    }

    await this.runAgentLoop();
  }

  async rejectAction(reason = 'User rejected the action'): Promise<void> {
    if (!this.awaitingConfirmation || this.pendingActions.length === 0) return;
    const actions = [...this.pendingActions];
    this.pendingActions = [];
    this.awaitingConfirmation = false;

    for (const pending of actions) {
      const rejection: UserRejectObservation = {
        type: 'UserRejectObservation',
        source: 'environment',
        rejection_reason: reason,
        tool_name: pending.actionEvent.tool_name,
        tool_call_id: pending.actionEvent.tool_call_id,
        action_id: pending.actionEvent.id ?? pending.actionEvent.tool_call_id,
      };
      this.pushEvent(rejection);
      this.appendToolMessage(pending.toolCall.id, { error: reason });
    }

    await this.runAgentLoop();
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

  private pushEvent(event: Event): Event | ConversationStateUpdateEvent {
    try {
      return this.events.push(event);
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  private resetConversation() {
    this.messages.splice(0, this.messages.length);
    this.pendingActions = [];
    this.awaitingConfirmation = false;
    this.paused = false;
  }

  private clampIterations(raw?: number | null): number {
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
    return Math.min(500, Math.max(1, n));
  }

  private buildToolDefinitions(): LLMToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'terminal',
          description: 'Execute a shell command in the workspace and return stdout/stderr.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              cwd: { type: 'string' },
              timeoutMs: { type: 'number' },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_editor',
          description: 'Write or append content to a file relative to the workspace root.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              append: { type: 'boolean' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'task_tracker',
          description: 'Track tasks by creating, updating, completing, or listing them.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'update', 'complete', 'list'] },
              id: { type: 'string' },
              title: { type: 'string' },
              notes: { type: 'string' },
              completed: { type: 'boolean' },
            },
            required: ['action'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser',
          description: 'Perform simple HTTP requests to read web content.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              method: { type: 'string', enum: ['GET', 'POST'] },
              body: { type: 'string' },
              maxBytes: { type: 'number' },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  private async ensureOrchestrator(): Promise<AgentOrchestrator> {
    if (this.orchestrator) return this.orchestrator;

    const llmConfig = this.settings.llm;
    if (!llmConfig?.model) {
      throw new Error('LLM model is required to run a local conversation');
    }

    const factory = new LLMFactory(
      {
        provider: llmConfig.provider ?? undefined,
        model: llmConfig.model,
        baseUrl: llmConfig.baseUrl ?? undefined,
        apiVersion: llmConfig.apiVersion ?? undefined,
        timeoutSeconds: llmConfig.timeout ?? undefined,
        temperature: llmConfig.temperature ?? undefined,
        topP: llmConfig.topP ?? undefined,
        topK: llmConfig.topK ?? undefined,
        maxInputTokens: llmConfig.maxInputTokens ?? undefined,
        maxOutputTokens: llmConfig.maxOutputTokens ?? undefined,
        nativeToolCalling: llmConfig.nativeToolCalling ?? undefined,
        reasoningEffort: llmConfig.reasoningEffort ?? undefined,
        apiKey: this.settings.secrets?.llmApiKey,
        headers: this.settings.secrets?.sessionApiKey
          ? { 'x-session-api-key': this.settings.secrets.sessionApiKey }
          : undefined,
      },
      { storage: this.storage },
    );

    const llm = await factory.createClient();
    this.orchestrator = new AgentOrchestrator(llm, { events: this.events, state: this.state });
    return this.orchestrator;
  }

  private async runAgentLoop(): Promise<void> {
    if (this.runningPromise) return this.runningPromise;

    this.runningPromise = this.innerRunLoop()
      .catch((err) => this.emit('error', err))
      .finally(() => {
        this.runningPromise = null;
      });

    return this.runningPromise;
  }

  private async innerRunLoop(): Promise<void> {
    const orchestrator = await this.ensureOrchestrator();
    this.state.setStatus('running');

    while (!this.paused && !this.awaitingConfirmation && this.state.snapshot.iteration < this.iterationLimit) {
      const response = await orchestrator.runChat({
        systemPrompt: this.systemPrompt,
        messages: [...this.messages],
        tools: this.toolDefinitions,
      });

      const assistantMessage: Message = { ...response.message, role: 'assistant' };
      this.messages.push(assistantMessage);
      const messageEvent = this.pushEvent({
        type: 'MessageEvent',
        source: 'agent',
        llm_message: assistantMessage,
        activated_skills: assistantMessage.activated_skills,
        activated_microagents: assistantMessage.activated_microagents,
      }) as MessageEvent;

      this.state.incrementIteration();

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (!toolCalls.length) {
        break;
      }

      const llmResponseId = assistantMessage.id ?? randomUUID();
      for (const call of toolCalls) {
        const handler = this.tools[call.function.name];
        if (!handler) {
          this.pushEvent({
            type: 'AgentErrorEvent',
            source: 'agent',
            error: `Unknown tool: ${call.function.name}`,
            tool_name: call.function.name,
            tool_call_id: call.id,
          });
          this.appendToolMessage(call.id, { error: `Unknown tool ${call.function.name}` });
          continue;
        }

        let parsedArgs: unknown;
        try {
          parsedArgs = handler.validate(JSON.parse(call.function.arguments || '{}'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.pushEvent({
            type: 'AgentErrorEvent',
            source: 'agent',
            error: message,
            tool_name: call.function.name,
            tool_call_id: call.id,
          });
          this.appendToolMessage(call.id, { error: message });
          continue;
        }

        const actionEvent = this.createActionEvent(call, parsedArgs, messageEvent.llm_message.reasoning_content, llmResponseId);
        this.pushEvent(actionEvent);

        if (this.requiresConfirmation()) {
          this.awaitingConfirmation = true;
          this.pendingActions.push({ actionEvent, handler, args: parsedArgs, toolCall: call });
          this.state.setStatus('waiting_for_confirmation');
          break;
        }

        await this.executeToolCall(handler, parsedArgs, call, actionEvent);
      }
    }

    if (!this.paused && !this.awaitingConfirmation) {
      this.state.setStatus('idle');
    }
  }

  private requiresConfirmation(): boolean {
    const policy = this.settings.confirmation?.policy ?? 'never';
    return policy === 'always' || policy === 'risky';
  }

  private createActionEvent(
    toolCall: ToolCall,
    args: unknown,
    reasoning: string | undefined,
    llmResponseId: string,
  ): ActionEvent {
    const thoughtContent = this.messages[this.messages.length - 1]?.content
      .filter(isTextContent)
      .map((item) => ({ type: 'text', text: item.text }));

    return {
      type: 'ActionEvent',
      source: 'agent',
      thought: thoughtContent ?? [],
      reasoning_content: reasoning,
      action: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : null,
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      tool_call: toolCall,
      llm_response_id: llmResponseId,
    };
  }

  private async executeToolCall(
    handler: ToolHandler<unknown, unknown>,
    args: unknown,
    toolCall: ToolCall,
    actionEvent: ActionEvent,
  ): Promise<void> {
    try {
      const commandId = handler.name === 'terminal' ? this.emitTerminalEvents(toolCall, args) : undefined;

      const result = await handler.execute(args as never, this.toolContext);
      const observation: ObservationEvent = {
        type: 'ObservationEvent',
        source: 'environment',
        observation: result as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? toolCall.id,
      };
      this.pushEvent(observation);
      if (handler.name === 'terminal') {
        this.emitTerminalOutputEvents(result as TerminalResult, commandId);
      }
      this.appendToolMessage(toolCall.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.pushEvent({
        type: 'AgentErrorEvent',
        source: 'agent',
        error: message,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      });
      this.appendToolMessage(toolCall.id, { error: message });
    }
  }

  private appendToolMessage(toolCallId: string, payload: unknown) {
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const message: Message = {
      role: 'tool',
      tool_call_id: toolCallId,
      content: [{ type: 'text', text: content }],
    };
    this.messages.push(message);
  }

  private emitTerminalEvents(toolCall: ToolCall, args: unknown): string {
    const commandId = toolCall.id || randomUUID();
    const now = new Date().toISOString();
    const parsed = typeof args === 'object' && args !== null ? (args as { command?: string; cwd?: string }) : {};

    const command: BashEvent = {
      type: 'BashCommand',
      id: randomUUID(),
      timestamp: now,
      command_id: commandId,
      order: 0,
      command: parsed.command ?? toolCall.function.arguments,
    } as BashEvent;
    this.emit('terminal', command);
    return commandId;
  }

  private emitTerminalOutputEvents(result: TerminalResult, commandId?: string) {
    const now = new Date().toISOString();
    const cid = commandId ?? randomUUID();
    const output: BashEvent = {
      type: 'BashOutput',
      id: randomUUID(),
      timestamp: now,
      command_id: cid,
      order: 1,
      exit_code: result.exitCode ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    } as BashEvent;

    const exit: BashEvent = {
      type: 'BashExit',
      id: randomUUID(),
      timestamp: now,
      command_id: cid,
      order: 2,
      exit_code: result.exitCode,
    } as BashEvent;

    this.emit('terminal', output);
    this.emit('terminal', exit);
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
