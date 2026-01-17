import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { isActionEvent, isCondensation, isConversationErrorEvent, isMessageEvent, isObservationEvent, isPauseEvent } from '../types';
import type { ToolDefinition } from '../types/tools';
import type { OpenHandsSettings } from '../types/settings';
import { FileEditorTool } from '../../tools';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

class SequencedLLM implements LLMClient {
  private idx = 0;

  constructor(private readonly sequences: LLMStreamChunk[][]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    const seq = this.sequences[this.idx] ?? [];
    this.idx += 1;
    for (const chunk of seq) {
      yield chunk;
    }
  }
}

class RecordingLLM implements LLMClient {
  private idx = 0;
  requests: ChatCompletionRequest[] = [];

  constructor(private readonly sequences: LLMStreamChunk[][]) {}

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    const seq = this.sequences[this.idx] ?? [];
    this.idx += 1;
    for (const chunk of seq) {
      yield chunk;
    }
  }
}

class CondensingLLM implements LLMClient {
  calls = 0;
  requests: ChatCompletionRequest[] = [];

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.requests.push(request);
    this.calls += 1;

    if (this.calls === 1) {
      throw new Error(
        'LLM request failed (400): litellm.ContextWindowExceededError: litellm.BadRequestError: AnthropicError - b\'{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 212624 tokens > 200000 maximum"},"request_id":"req_011CX7fivsByr5DdM7bEFA1K"}\'',
      );
    }

    if (this.calls === 2) {
      yield { type: 'text', text: 'SUMMARY' };
      yield { type: 'finish' };
      return;
    }

    yield { type: 'text', text: 'OK' };
    yield { type: 'finish' };
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));

describe('Agent loop control', () => {
  it('emits system prompt and stops when no tool calls', async () => {
    const log = new EventLog();
    const llm = new MockLLM([
      { type: 'text', text: 'Hello' },
      { type: 'finish' },
    ]);

    const agent = new Agent({ settings: baseSettings, events: log, workspaceRoot: createWorkspaceRoot(), llmClient: llm });

    await agent.run('hi there');

    const events = log.list();
    expect(events.some((event) => event.kind === 'SystemPromptEvent')).toBe(true);
    const messages = events.filter(isMessageEvent);
    expect(messages.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(agent.state.snapshot.iteration).toBe(1);
  });

  it('honors confirmation policy and executes tool on approval', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run tool');
    const eventsAfterRun = log.list();
    expect(eventsAfterRun.some(isActionEvent)).toBe(true);
    expect(eventsAfterRun.some(isPauseEvent)).toBe(true);
    expect(eventsAfterRun.some(isObservationEvent)).toBe(false);
    const pausesAfterRun = eventsAfterRun.filter(isPauseEvent);
    expect(pausesAfterRun).toHaveLength(1);
    expect(pausesAfterRun[0]?.source).toBe('agent');

    await agent.approveAction();
    const eventsAfterApproval = log.list();
    expect(eventsAfterApproval.some(isObservationEvent)).toBe(true);
    const toolMessages = eventsAfterApproval.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages.length).toBe(1);
  });

  it('emits a tool message when the user rejects a tool call (avoids stale tool_call_id)', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new RecordingLLM([
      [
        { type: 'text', text: 'Using tool' },
        { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Continuing' },
        { type: 'finish' },
      ],
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' }, conversation: { maxIterations: 2 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run tool');
    agent.rejectAction('nope');
    await agent.run('next message');

    const secondRequest = llm.requests[1];
    if (!secondRequest) {
      throw new Error('Expected a second LLM request after rejecting the tool call.');
    }

    const { messages } = secondRequest;
    const assistantIndex = messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.id === 'call_1'));
    const toolIndex = messages.findIndex((m) => m.role === 'tool' && m.tool_call_id === 'call_1');

    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(assistantIndex);
  });

  it('prompts for confirmation before accessing files outside the workspace', async () => {
    const log = new EventLog();
    const workspaceRoot = createWorkspaceRoot();
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-external-'));
    const outsidePath = path.join(externalDir, 'outside.txt');
    fs.writeFileSync(outsidePath, 'hello', 'utf8');

    const llm = new MockLLM([
      { type: 'text', text: 'Viewing file' },
      { type: 'tool_call_delta', id: 'call_1', name: 'file_editor', arguments: JSON.stringify({ command: 'view', path: outsidePath }) },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot,
      llmClient: llm,
      tools: [new FileEditorTool()],
    });

    await agent.run('view a file');
    const eventsAfterRun = log.list();
    expect(eventsAfterRun.some(isActionEvent)).toBe(true);
    expect(eventsAfterRun.some(isPauseEvent)).toBe(true);
    expect(eventsAfterRun.some(isObservationEvent)).toBe(false);
    const pausesAfterRun = eventsAfterRun.filter(isPauseEvent);
    expect(pausesAfterRun).toHaveLength(1);
    expect(pausesAfterRun[0]?.source).toBe('agent');

    await agent.approveAction();
    const eventsAfterApproval = log.list();
    const obs = eventsAfterApproval.filter(isObservationEvent).find((e) => e.tool_name === 'file_editor' && e.tool_call_id === 'call_1');
    expect(obs).toBeTruthy();
    expect(JSON.stringify(obs?.observation ?? {})).toContain('hello');

    fs.rmSync(externalDir, { recursive: true, force: true });
  });

  it('allows creating an external file after approval', async () => {
    const log = new EventLog();
    const workspaceRoot = createWorkspaceRoot();
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-external-create-'));
    const outsidePath = path.join(externalDir, 'new.txt');

    const llm = new MockLLM([
      { type: 'text', text: 'Creating file' },
      {
        type: 'tool_call_delta',
        id: 'call_create',
        name: 'file_editor',
        arguments: JSON.stringify({ command: 'create', path: outsidePath, file_text: 'hello' }),
      },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot,
      llmClient: llm,
      tools: [new FileEditorTool()],
    });

    await agent.run('create a file');
    const eventsAfterRun = log.list();
    expect(eventsAfterRun.some(isActionEvent)).toBe(true);
    expect(eventsAfterRun.some(isPauseEvent)).toBe(true);
    expect(eventsAfterRun.some(isObservationEvent)).toBe(false);
    const pausesAfterRun = eventsAfterRun.filter(isPauseEvent);
    expect(pausesAfterRun).toHaveLength(1);
    expect(pausesAfterRun[0]?.source).toBe('agent');

    await agent.approveAction();
    expect(fs.existsSync(outsidePath)).toBe(true);
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('hello');

    fs.rmSync(externalDir, { recursive: true, force: true });
  });

  it('does not grant directory access when creating an external file', async () => {
    const log = new EventLog();
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-external-create-siblings-'));
    const outsidePath = path.join(externalDir, 'new.txt');
    const siblingPath = path.join(externalDir, 'sibling.txt');
    fs.writeFileSync(siblingPath, 'sibling', 'utf8');

    const llm = new SequencedLLM([
      [
        { type: 'text', text: 'Creating file' },
        {
          type: 'tool_call_delta',
          id: 'call_create',
          name: 'file_editor',
          arguments: JSON.stringify({ command: 'create', path: outsidePath, file_text: 'hello' }),
        },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Viewing sibling' },
        { type: 'tool_call_delta', id: 'call_view', name: 'file_editor', arguments: JSON.stringify({ command: 'view', path: siblingPath }) },
        { type: 'finish' },
      ],
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, conversation: { maxIterations: 2 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [new FileEditorTool()],
    });

    await agent.run('create then view');
    const pausesAfterRun = log.list().filter(isPauseEvent);
    expect(pausesAfterRun).toHaveLength(1);
    expect(pausesAfterRun[0]?.source).toBe('agent');

    await agent.approveAction();
    expect(fs.existsSync(outsidePath)).toBe(true);

    const pauses = log.list().filter(isPauseEvent);
    expect(pauses.length).toBe(2);
    expect(pauses.every((pause) => pause.source === 'agent')).toBe(true);

    const siblingObs = log.list().filter(isObservationEvent).find((e) => e.tool_call_id === 'call_view');
    expect(siblingObs).toBeUndefined();

    fs.rmSync(externalDir, { recursive: true, force: true });
  });

  it('records agent error when tool arguments are not objects', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call_delta', id: 'call_invalid', name: 'echo', arguments: 'false' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });
    await agent.run('bad args');

    const events = log.list();
    const agentErrors = events.filter((event) => event.kind === 'AgentErrorEvent');
    expect(agentErrors).toHaveLength(1);
    expect((agentErrors[0] as { tool_call_id?: string }).tool_call_id).toBe('call_invalid');

    const actions = events.filter(isActionEvent);
    expect(actions).toHaveLength(0);

    expect(events.some(isObservationEvent)).toBe(false);
  });

  it('handles JSON primitives in tool arguments by emitting agent error', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      { type: 'tool_call_delta', id: 'call_primitive', name: 'echo', arguments: '42' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });
    await agent.run('bad args');

    const events = log.list();
    const agentErrors = events.filter((event) => event.kind === 'AgentErrorEvent');
    expect(agentErrors).toHaveLength(1);
    expect((agentErrors[0] as { tool_call_id?: string }).tool_call_id).toBe('call_primitive');

    const actions = events.filter(isActionEvent);
    expect(actions).toHaveLength(0);

    expect(events.some(isObservationEvent)).toBe(false);
  });

  it('runs condensation after a context-limit error and retries the LLM request', async () => {
    const log = new EventLog();
    const llm = new CondensingLLM();

    const seededMessageIds: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const evt = log.push({
        kind: 'MessageEvent',
        source: i % 2 === 0 ? 'user' : 'agent',
        llm_message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `seed ${i} ` + 'x'.repeat(2_000) }],
        },
      } as any) as any;
      seededMessageIds.push(String(evt.id));
    }

    const agent = new Agent({
      settings: { ...baseSettings, llm: { ...baseSettings.llm, provider: 'litellm_proxy', maxInputTokens: 8000 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
    });

    await agent.run('trigger');

    expect(llm.calls).toBe(3);
    const condensation = log.list().find(isCondensation);
    expect(condensation).toBeTruthy();
    expect(condensation?.summary).toBe('SUMMARY');
    expect(condensation?.forgotten_event_ids).not.toContain(seededMessageIds[0]);
    expect(condensation?.forgotten_event_ids).toContain(seededMessageIds[1]);

    const retryRequest = [...llm.requests].reverse().find((req) => req.systemPrompt.includes('<CONVERSATION SUMMARY>'));
    expect(retryRequest).toBeTruthy();
    expect(retryRequest?.systemPrompt).toContain('SUMMARY');

    const assistantMessages = log.list().filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'assistant');
    expect(assistantMessages.some((evt) => evt.llm_message.content.some((part) => part.type === 'text' && part.text.includes('OK')))).toBe(true);
  });

  it('emits ConversationErrorEvent and sets status to IDLE when maxIterations is reached', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    // LLM that always returns a tool call, forcing continuous iterations
    const llm = new SequencedLLM([
      [
        { type: 'text', text: 'Calling tool 1' },
        { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"1"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Calling tool 2' },
        { type: 'tool_call_delta', id: 'call_2', name: 'echo', arguments: '{"value":"2"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Calling tool 3' },
        { type: 'tool_call_delta', id: 'call_3', name: 'echo', arguments: '{"value":"3"}' },
        { type: 'finish' },
      ],
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, conversation: { maxIterations: 2 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('keep iterating');

    // Should have stopped after 2 iterations
    expect(agent.state.snapshot.iteration).toBe(2);

    // Should have emitted a ConversationErrorEvent with max_iterations_exceeded code
    const errorEvents = log.list().filter(isConversationErrorEvent);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]?.code).toBe('max_iterations_exceeded');
    expect(errorEvents[0]?.detail).toContain('maximum iteration limit');
    expect(errorEvents[0]?.detail).toContain('2');

    // Status should be IDLE, not stuck on RUNNING
    expect(agent.state.snapshot.status).toBe('IDLE');
  });

  it('does not emit maxIterations error when loop exits for other reasons', async () => {
    const log = new EventLog();
    const llm = new MockLLM([
      { type: 'text', text: 'Hello, done!' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, conversation: { maxIterations: 10 } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
    });

    await agent.run('hi');

    // Should complete after 1 iteration (no tool calls)
    expect(agent.state.snapshot.iteration).toBe(1);

    // Should NOT have a max_iterations_exceeded error
    const errorEvents = log.list().filter(isConversationErrorEvent);
    const maxIterErrors = errorEvents.filter((e) => e.code === 'max_iterations_exceeded');
    expect(maxIterErrors.length).toBe(0);

    // Status should be IDLE
    expect(agent.state.snapshot.status).toBe('IDLE');
  });

  it('allows continuation after maxIterations is increased', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new SequencedLLM([
      [
        { type: 'text', text: 'Calling tool 1' },
        { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"1"}' },
        { type: 'finish' },
      ],
      [
        { type: 'text', text: 'Done now' },
        { type: 'finish' },
      ],
    ]);

    const settings = { ...baseSettings, conversation: { maxIterations: 1 } };
    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('start');

    // First run hits maxIterations
    expect(agent.state.snapshot.iteration).toBe(1);
    expect(agent.state.snapshot.status).toBe('IDLE');
    const firstErrors = log.list().filter(isConversationErrorEvent).filter((e) => e.code === 'max_iterations_exceeded');
    expect(firstErrors.length).toBe(1);

    // Increase maxIterations via setSettings
    agent.setSettings({ ...settings, conversation: { maxIterations: 10 } });

    // Continue conversation
    await agent.run('continue please');

    // Should have completed additional iterations
    expect(agent.state.snapshot.iteration).toBe(2);
    expect(agent.state.snapshot.status).toBe('IDLE');

    // No new max_iterations_exceeded error
    const allErrors = log.list().filter(isConversationErrorEvent).filter((e) => e.code === 'max_iterations_exceeded');
    expect(allErrors.length).toBe(1); // Still just the first one
  });


  it('emits a ConversationErrorEvent when stuck detection triggers', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const seq = (id: string) => ([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id, name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ] as const);

    const llm = new SequencedLLM([
      [...seq('call_1')],
      [...seq('call_2')],
      // The third response should never be needed if stuck detection triggers.
      [...seq('call_3')],
    ]);

    const agent = new Agent({
      settings: {
        ...baseSettings,
        conversation: {
          maxIterations: 50,
          stuckDetection: true,
          stuckThresholds: {
            actionObservation: 2,
            actionError: 2,
            monologue: 2,
            alternatingPattern: 4,
          },
        },
      },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('start');

    const stuckErrors = log.list().filter(isConversationErrorEvent).filter((e) => e.code === 'stuck_detected');
    expect(stuckErrors.length).toBe(1);
    expect(agent.state.snapshot.status).toBe('IDLE');
  });

});
