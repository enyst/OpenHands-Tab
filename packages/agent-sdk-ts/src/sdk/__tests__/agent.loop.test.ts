import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { isActionEvent, isMessageEvent, isObservationEvent, isPauseEvent } from '../types';
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

    await agent.approveAction();
    const eventsAfterApproval = log.list();
    expect(eventsAfterApproval.some(isObservationEvent)).toBe(true);
    const toolMessages = eventsAfterApproval.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages.length).toBe(1);
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
    expect(log.list().filter(isPauseEvent).length).toBe(1);

    await agent.approveAction();
    expect(fs.existsSync(outsidePath)).toBe(true);

    const pauses = log.list().filter(isPauseEvent);
    expect(pauses.length).toBe(2);

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
});
