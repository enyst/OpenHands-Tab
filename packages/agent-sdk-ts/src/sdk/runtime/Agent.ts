import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import { AgentOrchestrator } from './AgentOrchestrator';
import { AsyncLock } from './AsyncLock';
import { ConversationState } from './ConversationState';
import { EventLog } from './EventLog';
import type { LLMClient, LLMToolDefinition } from '../llm';
import { LLMFactory } from '../llm';
import type { ActionEvent, BashEvent, Event, Message, MessageEvent, ToolCall } from '../types';
import { isTextContent, isMessageEvent, isSystemPromptEvent, type SecurityRisk } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolHandler } from '../types/tools';
import { LocalWorkspace } from '../../workspace/LocalWorkspace';
import { SecretRegistry } from './SecretRegistry';
import type { AgentContext } from '../context';

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
  tools?: ToolHandler<unknown, unknown>[];
  events?: EventLog;
  state?: ConversationState;
  secrets?: SecretRegistry;
  agentContext?: AgentContext;
  onTerminalEvent?: (event: BashEvent) => void;
}

const SYSTEM_PROMPT = 'You are OpenHands, an autonomous AI agent running inside VS Code.';

export class Agent extends EventEmitter {
  private readonly workspace: LocalWorkspace;
  private readonly events: EventLog;
  readonly state: ConversationState;
  private readonly secrets: SecretRegistry;
  private readonly tools: Map<string, ToolHandler<unknown, unknown>>;
  private readonly confirmation: ConfirmationPolicy;
  private readonly lock = new AsyncLock();
  private orchestratorPromise?: Promise<AgentOrchestrator>;
  private paused = false;
  private cancelled = false;
  private pendingAction?: { toolCall: ToolCall; actionEvent: ActionEvent; args: Record<string, unknown> };
  private readonly agentContext?: AgentContext;
  private readonly activatedSkillNames: string[] = [];

  constructor(private readonly options: AgentOptions) {
    super();
    this.workspace = new LocalWorkspace(options.workspaceRoot);
    this.events = options.events ?? new EventLog();
    this.state = options.state ?? new ConversationState(this.events);
    this.state.attachEventLog(this.events);
    this.secrets = options.secrets ?? new SecretRegistry();
    const providedTools = options.tools ?? [];
    this.tools = new Map(providedTools.map((tool) => [tool.name, tool]));
    this.confirmation = {
      policy: options.settings?.confirmation?.policy ?? 'never',
      riskyThreshold: options.settings?.confirmation?.riskyThreshold ?? 'MEDIUM',
      confirmUnknown: options.settings?.confirmation?.confirmUnknown ?? true,
    };
    this.agentContext = options.agentContext;

    this.events.on((event) => this.emit('event', event));
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
    const pause: Event = { kind: 'PauseEvent', source: 'user' } as Event;
    this.events.push(pause);
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
    this.state.setStatus('CANCELLED');
  }

  async approveAction(): Promise<void> {
    if (!this.pendingAction) return;
    await this.lock.acquire(async () => {
      const pending = this.pendingAction!;
      this.pendingAction = undefined;
      this.state.setStatus('RUNNING');
      await this.executeTool(pending.toolCall, pending.actionEvent, pending.args);
      await this.runLoop();
    });
  }

  rejectAction(reason?: string): void {
    if (!this.pendingAction) return;
    const { actionEvent, toolCall } = this.pendingAction;
    this.pendingAction = undefined;
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

  private async runLoop(): Promise<Message | undefined> {
    if (this.paused || this.pendingAction || this.cancelled) {
      return undefined;
    }

    const maxIterations = this.clampMaxIterations();
    const orchestrator = await this.getOrchestrator();
    let lastAssistantMessage: Message | undefined;

    while (!this.paused && !this.pendingAction && !this.cancelled && this.state.snapshot.iteration < maxIterations) {
      this.state.setStatus('RUNNING');
      const request = this.buildChatRequest();
      let response;
      try {
        response = await orchestrator.runChat(request);
      } catch (error) {
        this.events.push({
          kind: 'ConversationErrorEvent',
          source: 'agent',
          detail: error instanceof Error ? error.message : String(error),
        } as Event);
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
        const parsedArgs = this.parseToolArgs(toolCall);
        if (!parsedArgs) {
          toolExecutionFailed = true;
          break;
        }
        const { args, securityRisk } = parsedArgs;
        const actionEvent = this.createActionEvent(response.message, toolCall, args, securityRisk);
        const recordedAction = this.events.push(actionEvent) as ActionEvent;

        if (this.requiresConfirmation(recordedAction)) {
          this.pendingAction = { toolCall, actionEvent: recordedAction, args };
          this.state.setStatus('WAITING_FOR_CONFIRMATION');
          this.events.push({ kind: 'PauseEvent', source: 'user' } as Event);
          return lastAssistantMessage;
        }

        try {
          await this.executeTool(toolCall, recordedAction, args);
        } catch {
          toolExecutionFailed = true;
          break;
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
    // Build system prompt with agent context if available
    let systemPrompt = SYSTEM_PROMPT;
    if (this.agentContext) {
      const suffix = this.agentContext.getSystemMessageSuffix();
      if (suffix) {
        systemPrompt += '\n\n' + suffix;
      }
    }

    const messages = this.events
      .list()
      .filter(isMessageEvent)
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

  private getToolDefinitionsForEvent(): Record<string, unknown>[] {
    return this.getToolDefinitions().map((tool) => tool as unknown as Record<string, unknown>);
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
    const factory = new LLMFactory(config, { secrets: this.secrets });
    return factory.createClient();
  }

  private ensureSystemPrompt() {
    const existing = this.events.list().find(isSystemPromptEvent);
    if (existing) return;

    // Build system prompt with agent context if available
    let systemPrompt = SYSTEM_PROMPT;
    if (this.agentContext) {
      const suffix = this.agentContext.getSystemMessageSuffix();
      if (suffix) {
        systemPrompt += '\n\n' + suffix;
      }
    }

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

  private parseToolArgs(toolCall: ToolCall): { args: Record<string, unknown>; securityRisk?: SecurityRisk } | undefined {
    const raw = toolCall.function.arguments;
    if (!raw) return { args: {} };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const { security_risk, ...rest } = parsed as Record<string, unknown>;
        return { args: rest, securityRisk: security_risk as SecurityRisk | undefined };
      }
      throw new Error('Tool arguments must be a JSON object.');
    } catch (e) {
      this.events.push({
        kind: 'AgentErrorEvent',
        source: 'agent',
        error: `Invalid tool arguments: ${e instanceof Error ? e.message : String(e)}`,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      } as Event);
      return undefined;
    }
  }

  private requiresConfirmation(action: ActionEvent): boolean {
    const policy = this.confirmation.policy ?? 'never';
    if (policy === 'never') return false;
    if (policy === 'always') return true;
    const risk = action.security_risk;
    if (!risk) return this.confirmation.confirmUnknown ?? true;
    const order: SecurityRisk[] = ['LOW', 'MEDIUM', 'HIGH'];
    const threshold = this.confirmation.riskyThreshold ?? 'MEDIUM';
    return order.indexOf(risk) >= order.indexOf(threshold);
  }

  private createActionEvent(
    message: Message,
    toolCall: ToolCall,
    args: Record<string, unknown>,
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
      this.events.push({
        kind: 'AgentErrorEvent',
        source: 'agent',
        error: `Unknown tool: ${toolCall.function.name}`,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      } as Event);
      return;
    }

    let validated;
    try {
      validated = tool.validate(args);
    } catch (e) {
      this.events.push({
        kind: 'AgentErrorEvent',
        source: 'agent',
        error: `Tool validation failed: ${e instanceof Error ? e.message : String(e)}`,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
      } as Event);
      return;
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
        observation: result as Record<string, unknown>,
        tool_name: toolCall.function.name,
        tool_call_id: toolCall.id,
        action_id: actionEvent.id ?? randomUUID(),
      } as Event;
      this.events.push(observation);

      const toolMessage: MessageEvent = {
        kind: 'MessageEvent',
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
        kind: 'ConversationErrorEvent',
        source: 'environment',
        detail: e instanceof Error ? e.message : String(e),
        code: 'tool_execution_failed',
      } as Event);
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
