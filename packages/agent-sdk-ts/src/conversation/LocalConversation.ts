import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type { ChatCompletionRequest, LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import { buildToolsPrompt } from '../llm/toolPrompt';
import { AgentOrchestrator, AsyncLock, EventLog, SecretRegistry } from '../runtime';
import { FileEditorTool, TaskTrackerTool, TerminalTool } from '../tools';
import type { ToolHandler } from '../tools/types';
import type { BashEvent, Event, Message, ToolCall } from '../types';
import { isBashEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { LocalWorkspace } from '../workspace';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

export interface LocalConversationOptions {
  settings: OpenHandsSettings;
  conversationId?: string;
  workspaceRoot?: string;
  /**
   * Optional client used for testing. When not provided, LLMFactory builds the client
   * from the supplied settings.
   */
  llmClient?: LLMClient;
}

type ToolMap = Record<string, ToolHandler<unknown, unknown>>;

export class LocalConversation extends EventEmitter {
  private status: ConversationStatus = 'offline';
  private conversationId?: string;
  private settings: OpenHandsSettings;
  private readonly workspace: LocalWorkspace;
  private readonly tools: ToolMap;
  private readonly events = new EventLog();
  private readonly secrets = new SecretRegistry();
  private readonly lock = new AsyncLock();
  private readonly messages: Message[] = [];
  private readonly providedClient?: LLMClient;

  constructor(options: LocalConversationOptions) {
    super();
    this.settings = options.settings;
    this.conversationId = options.conversationId;
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.providedClient = options.llmClient;
    this.tools = {
      terminal: new TerminalTool(),
      file_editor: new FileEditorTool(),
      task_tracker: new TaskTrackerTool(),
    } as ToolMap;

    this.events.on((event) => {
      this.emit('event', event);
    });
    this.setStatus('online');
  }

  get mode(): 'local' { return 'local'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
  }

  startNewConversation(): Promise<string | undefined> {
    this.conversationId = `local-${randomUUID()}`;
    this.messages.length = 0;
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
      const userMessage: Message = { role: 'user', content: [{ type: 'text', text }], id: randomUUID() };
      this.messages.push(userMessage);
      this.events.push({ type: 'MessageEvent', source: 'user', llm_message: userMessage });
      await this.runAgentLoop();
    });
  }

  pause(): Promise<void> {
    this.events.push({ type: 'PauseEvent', source: 'user' });
    return Promise.resolve();
  }

  resume(): Promise<void> { return Promise.resolve(); /* local resume no-op */ }

  approveAction(): Promise<void> { return Promise.resolve(); /* local approve no-op */ }

  rejectAction(_reason?: string): Promise<void> { return Promise.resolve(); /* local reject no-op */ }

  disconnect() {
    this.setStatus('offline');
  }

  reconnect() {
    this.setStatus('online');
  }

  private async runAgentLoop(): Promise<void> {
    const maxIterations = Math.min(Math.max(this.settings?.conversation.maxIterations ?? 4, 1), 10);
    let lastAssistantMessage: Message | undefined;
    for (let i = 0; i < maxIterations; i += 1) {
      const response = await this.generateAssistantMessage();
      const assistantMessage = response.message;
      lastAssistantMessage = assistantMessage;
      this.messages.push(assistantMessage);
      this.events.push({ type: 'MessageEvent', source: 'agent', llm_message: assistantMessage });

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (!toolCalls.length) {
        return;
      }

      await this.handleToolCalls(toolCalls, assistantMessage);
    }

    if (lastAssistantMessage?.tool_calls?.length) {
      const finalResponse = await this.generateAssistantMessage([]);
      const finalMessage = finalResponse.message;
      this.messages.push(finalMessage);
      this.events.push({ type: 'MessageEvent', source: 'agent', llm_message: finalMessage });
    }
  }

  private async generateAssistantMessage(tools?: ChatCompletionRequest['tools']) {
    const llm = this.providedClient ?? (await this.createLlmClient());
    const orchestrator = new AgentOrchestrator(llm, { events: this.events });
    const request: ChatCompletionRequest = {
      systemPrompt: this.buildSystemPrompt(),
      messages: [...this.messages],
      tools: tools ?? this.buildToolSchemas(),
    };
    return orchestrator.runChat(request);
  }

  private async handleToolCalls(toolCalls: ToolCall[], assistantMessage: Message): Promise<void> {
    for (const call of toolCalls) {
      const actionId = randomUUID();
      const args = this.parseToolArgs(call);
      const thoughtText = assistantMessage.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ');

      this.events.push({
        type: 'ActionEvent',
        source: 'agent',
        thought: thoughtText ? [{ type: 'text', text: thoughtText }] : [],
        action: args ?? null,
        tool_name: call.function.name,
        tool_call_id: call.id,
        tool_call: call,
        llm_response_id: assistantMessage.id ?? randomUUID(),
      });

      const handler = this.tools[call.function.name];
      if (!handler) {
        this.events.push({
          type: 'AgentErrorEvent',
          source: 'agent',
          error: `Unsupported tool: ${call.function.name}`,
          tool_name: call.function.name,
          tool_call_id: call.id,
        });
        continue;
      }

      try {
        const observation = await this.executeTool(handler, args);
        this.events.push({
          type: 'ObservationEvent',
          source: 'environment',
          observation: observation ?? {},
          tool_name: call.function.name,
          tool_call_id: call.id,
          action_id: actionId,
        });
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: [{ type: 'text', text: JSON.stringify(observation ?? {}) }],
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.events.push({
          type: 'AgentErrorEvent',
          source: 'agent',
          error,
          tool_name: call.function.name,
          tool_call_id: call.id,
        });
      }
    }
  }

  private parseToolArgs(call: ToolCall): unknown {
    try {
      return JSON.parse(call.function.arguments || '{}');
    } catch (e) {
      const err = e instanceof Error ? e.message : 'unknown error parsing tool args';
      this.events.push({
        type: 'AgentErrorEvent',
        source: 'agent',
        error: `Failed to parse tool arguments: ${err}`,
        tool_name: call.function.name,
        tool_call_id: call.id,
      });
      return {};
    }
  }

  private async executeTool(handler: ToolHandler<unknown, unknown>, args: unknown) {
    if (handler.name === 'terminal') {
      const parsed = handler.validate(args) as { command: string; cwd?: string; timeoutMs?: number };
      const commandId = randomUUID();
      this.emitBashEvent({
        type: 'BashCommand',
        command: parsed.command,
        command_id: commandId,
        id: randomUUID(),
        order: 0,
        timestamp: new Date().toISOString(),
      });
      const result = await handler.execute(parsed, { workspace: this.workspace, events: this.events, secrets: this.secrets });
      if (typeof result === 'object' && result && 'stdout' in result && 'stderr' in result) {
        const output = result as { stdout?: string; stderr?: string; exitCode?: number };
        this.emitBashEvent({
          type: 'BashOutput',
          command_id: commandId,
          id: randomUUID(),
          order: 1,
          timestamp: new Date().toISOString(),
          exit_code: output.exitCode ?? null,
          stdout: output.stdout ?? null,
          stderr: output.stderr ?? null,
        });
        this.emitBashEvent({
          type: 'BashExit',
          command_id: commandId,
          id: randomUUID(),
          order: 2,
          timestamp: new Date().toISOString(),
          exit_code: output.exitCode ?? -1,
        });
      }
      return result;
    }

    const validated = handler.validate(args);
    return handler.execute(validated, { workspace: this.workspace, events: this.events, secrets: this.secrets });
  }

  private emitBashEvent(event: BashEvent) {
    if (!isBashEvent(event)) return;
    this.emit('terminal', event);
  }

  private buildSystemPrompt(): string {
    const toolsPrompt = buildToolsPrompt(this.buildToolSchemas());
    return [
      'You are OpenHands running locally inside VS Code.',
      'Use the available tools to inspect and modify files in the workspace when needed.',
      'Respond concisely and prefer tool calls over guesswork.',
      toolsPrompt,
    ].join('\n\n');
  }

  private buildToolSchemas(): ChatCompletionRequest['tools'] {
    return [
      {
        type: 'function',
        function: {
          name: 'terminal',
          description: 'Execute bash commands inside the workspace',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Shell command to execute' },
              cwd: { type: 'string', description: 'Working directory relative to workspace' },
              timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
            },
            required: ['command'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_editor',
          description: 'Write or append file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path of the target file' },
              content: { type: 'string', description: 'Content to write' },
              append: { type: 'boolean', description: 'Append instead of overwrite' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'task_tracker',
          description: 'Track tasks completed by the agent',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'complete', 'list', 'update'] },
              id: { type: 'string', description: 'Task identifier for updates' },
              title: { type: 'string' },
              notes: { type: 'string' },
              completed: { type: 'boolean' },
            },
            required: ['action'],
          },
        },
      },
    ];
  }

  private async createLlmClient(): Promise<LLMClient> {
    const model = this.settings?.llm?.model;
    if (!model) {
      throw new Error('Missing LLM model in settings. Set openhands.llm.model in VS Code settings.');
    }
    const factory = new LLMFactory({
      model,
      baseUrl: this.settings.llm.baseUrl ?? undefined,
      apiVersion: this.settings.llm.apiVersion ?? undefined,
      temperature: this.settings.llm.temperature ?? undefined,
      topP: this.settings.llm.topP ?? undefined,
      topK: this.settings.llm.topK ?? undefined,
      maxInputTokens: this.settings.llm.maxInputTokens ?? undefined,
      maxOutputTokens: this.settings.llm.maxOutputTokens ?? undefined,
      nativeToolCalling: this.settings.llm.nativeToolCalling ?? true,
      reasoningEffort: this.settings.llm.reasoningEffort ?? undefined,
      apiKey: this.settings.secrets.llmApiKey,
    });
    return factory.createClient();
  }

  private setStatus(status: ConversationStatus) {
    this.status = status;
    this.emit('status', status);
  }
}

export type LocalConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};
