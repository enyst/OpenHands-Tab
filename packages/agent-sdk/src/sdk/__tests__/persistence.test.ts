import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { LocalConversation } from '../conversation';
import { ConversationState, EventLog, FileStore } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import type { Event, MessageEvent, TextContent } from '../types';
import { isObservationEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import type { ToolDefinition } from '../types/tools';
import { FileEditorTool } from '../../tools/FileEditorTool';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
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

const makeTempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('FileStore', () => {
  it('serializes and restores events with stable ids', () => {
    const dir = makeTempDir('conversation-persist-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-1' });
    const log = new EventLog({ persistence });

    const recorded = log.push({
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    } as Event);

    const events = persistence.readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(recorded.id);
    expect(events[0].timestamp).toBe(recorded.timestamp);
  });

  it('persists state snapshots and replays from events', () => {
    const dir = makeTempDir('conversation-state-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-2' });
    const log = new EventLog({ persistence });
    const state = new ConversationState({ eventLog: log, persistence });

    state.setStatus('RUNNING');
    state.incrementIteration();
    state.setValue('llm_usage', { input: 1 });

    const snapshot = persistence.readState();
    expect(snapshot).toEqual(state.snapshot);

    const replayedState = new ConversationState({ eventLog: new EventLog() });
    replayedState.loadEvents(persistence.readEvents());
    expect(replayedState.snapshot).toEqual(state.snapshot);
  });

  it('persists and restores LLM config', () => {
    const dir = makeTempDir('conversation-llm-config-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-llm' });
    persistence.writeLlmConfig?.({
      profileId: 'sonnet-45',
      baseUrl: 'http://example.test',
      temperature: 0.25,
    });

    expect(persistence.readLlmConfig?.()).toEqual({
      profileId: 'sonnet-45',
      baseUrl: 'http://example.test',
      temperature: 0.25,
    });
  });

  it('creates directories and files with restrictive permissions', () => {
    if (process.platform === 'win32') return;

    const dir = makeTempDir('conversation-perms-');
    const conversationId = 'conv-perms';
    const persistence = new FileStore({ rootDir: dir, conversationId });

    persistence.appendEvent({
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    } as Event);

    persistence.writeState({ status: 'idle', iteration: 0, values: {} } as any);
    persistence.writeLlmConfig?.({ profileId: 'test-profile' });

    const conversationDir = path.join(dir, conversationId);
    expect(fs.statSync(conversationDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(conversationDir, 'events.jsonl')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(conversationDir, 'state.json')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(conversationDir, 'llm.json')).mode & 0o777).toBe(0o600);
  });
});


describe('EventLog filtering', () => {
  it('does not persist transient LLM streaming updates (llm_stream, llm_tool_call)', () => {
    const dir = makeTempDir('conversation-stream-filter-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-stream' });
    const log = new EventLog({ persistence });

    // Push transient streaming updates
    log.push({ kind: 'ConversationStateUpdateEvent', key: 'llm_stream', value: 'partial', source: 'agent' } as unknown as Event);
    log.push({ kind: 'ConversationStateUpdateEvent', key: 'llm_tool_call', value: 'call_123', source: 'agent' } as unknown as Event);

    // Push a durable final assistant message
    log.push({
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
    } as Event);

    const events = persistence.readEvents();
    expect(events).toHaveLength(1);
    const only = events[0] as MessageEvent;
    expect(only.kind).toBe('MessageEvent');
    expect((only.llm_message.content[0] as TextContent).text).toBe('final answer');
  });
});


describe('LocalConversation persistence', () => {
  it('replays persisted history when restored', async () => {
    const dir = makeTempDir('local-conversation-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([{ type: 'text', text: 'hello' }, { type: 'finish' }]);

    const conversation = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });

    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('hello');
    const initialState = (conversation as unknown as { state: ConversationState }).state.snapshot;

    const replayed: Event[] = [];
    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    restored.on('event', (event) => replayed.push(event));
    restored.restoreConversation(id!);

    expect(replayed.length).toBeGreaterThan(0);
    const restoredState = (restored as unknown as { state: ConversationState }).state.snapshot;
    expect(restoredState.iteration).toBe(initialState.iteration);
    expect(restoredState.values.llm_usage).toEqual(initialState.values.llm_usage);
  });

  it('rejects conversation ids with path separators', () => {
    const dir = makeTempDir('local-conversation-unsafe-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([{ type: 'finish' }]);

    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });

    expect(() => restored.restoreConversation('../escape')).toThrow(/Invalid conversation id/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('restores persisted LLM config on conversation restore', async () => {
    const dir = makeTempDir('local-conversation-llm-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([{ type: 'text', text: 'hello' }, { type: 'finish' }]);

    const conversation = new LocalConversation({
      settings: { ...baseSettings, llm: { profileId: 'sonnet-45' } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('hello');

    const restored = new LocalConversation({
      settings: { ...baseSettings, llm: { model: 'restored-model' } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    restored.restoreConversation(id!);

    const restoredSettings = (restored as unknown as { settings: OpenHandsSettings }).settings;
    expect(restoredSettings.llm.profileId).toBe('sonnet-45');
    expect(restoredSettings.llm.model).toBeUndefined();
  });

  it('does not persist or restore raw LLM fields when a profileId is present', async () => {
    const dir = makeTempDir('local-conversation-llm-profile-only-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([{ type: 'text', text: 'hello' }, { type: 'finish' }]);

    const conversation = new LocalConversation({
      settings: { ...baseSettings, llm: { profileId: 'sonnet-45', baseUrl: 'http://should-not-persist', temperature: 0.25 } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('hello');

    const store = new FileStore({ rootDir: dir, conversationId: id! });
    expect(store.readLlmConfig?.()).toEqual({ profileId: 'sonnet-45' });

    store.writeLlmConfig?.({ profileId: 'sonnet-45', baseUrl: 'http://persisted', temperature: 0.9 });

    const restored = new LocalConversation({
      settings: { ...baseSettings, llm: { model: 'restored-model', baseUrl: 'http://restored', temperature: 0.1 } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    restored.restoreConversation(id!);

    const restoredSettings = (restored as unknown as { settings: OpenHandsSettings }).settings;
    expect(restoredSettings.llm.profileId).toBe('sonnet-45');
    expect(restoredSettings.llm.model).toBeUndefined();
    expect(restoredSettings.llm.baseUrl).toBeUndefined();
    expect(restoredSettings.llm.temperature).toBeUndefined();
  });

  it('ignores corrupted persisted LLM config', async () => {
    const dir = makeTempDir('local-conversation-llm-corrupt-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([{ type: 'text', text: 'hello' }, { type: 'finish' }]);

    const conversation = new LocalConversation({
      settings: { ...baseSettings, llm: { profileId: 'sonnet-45' } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('hello');

    fs.writeFileSync(path.join(dir, id!, 'llm.json'), '{not-json', 'utf8');

    const restored = new LocalConversation({
      settings: { ...baseSettings, llm: { model: 'restored-model' } },
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });

    expect(() => restored.restoreConversation(id!)).not.toThrow();
    const restoredSettings = (restored as unknown as { settings: OpenHandsSettings }).settings;
    expect(restoredSettings.llm.model).toBe('restored-model');
  });

  it('continues conversation after restoration', async () => {
    const dir = makeTempDir('local-continuation-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const llm = new MockLLM([
      { type: 'text', text: 'first response' },
      { type: 'finish' },
      { type: 'text', text: 'second response' },
      { type: 'finish' },
    ]);

    // Start conversation and send first message
    const conversation = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });

    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('first message');

    // Restore and continue
    const restoredEvents: Event[] = [];
    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      persistenceDir: dir,
    });
    restored.on('event', (e) => restoredEvents.push(e));
    restored.restoreConversation(id!);

    const messagesBefore = restoredEvents.length;
    await restored.sendUserMessage('second message');
    const messagesAfter = restoredEvents.length;

    expect(messagesAfter).toBeGreaterThan(messagesBefore);
  });

  it('restores pending confirmations so approveAction works after restore', async () => {
    const dir = makeTempDir('local-confirmation-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const settings: OpenHandsSettings = { ...baseSettings, confirmation: { policy: 'always' } };
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input: unknown) => {
        if (input && typeof input === 'object' && 'value' in input) {
          const value = (input as { value?: unknown }).value;
          if (typeof value === 'string') {
            return { value };
          }
        }
        throw new Error('Invalid input for echo tool');
      },
      execute: async (args) => ({ echoed: args.value }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const conversation = new LocalConversation({
      settings,
      workspaceRoot,
      llmClient: llm,
      tools: [tool],
      persistenceDir: dir,
    });

    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('run tool');
    const stateAfterRun = (conversation as unknown as { state: ConversationState }).state.snapshot;
    expect(stateAfterRun.status).toBe('WAITING_FOR_CONFIRMATION');

    const restoredEvents: Event[] = [];
    const restored = new LocalConversation({
      settings,
      workspaceRoot,
      llmClient: new MockLLM([{ type: 'finish' }]),
      tools: [tool],
      persistenceDir: dir,
    });
    restored.on('event', (e) => restoredEvents.push(e));
    restored.restoreConversation(id!);

    const before = restoredEvents.length;
    await restored.approveAction();
    const newEvents = restoredEvents.slice(before);

    const observation = newEvents.find((e) => isObservationEvent(e) && e.tool_name === 'echo');
    expect(observation).toBeDefined();
    expect(JSON.stringify(observation?.observation ?? {})).toContain('hi');
  });

  it('restores pending workspace access confirmations so approveAction allows file_editor paths after restore', async () => {
    const dir = makeTempDir('local-workspace-access-');
    const workspaceRoot = makeTempDir('local-workspace-');
    const outsideDir = makeTempDir('local-outside-workspace-');
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const fileEditor = new FileEditorTool();

    const llm = new MockLLM([
      { type: 'tool_call_delta', id: 'call_1', name: 'file_editor', arguments: JSON.stringify({ command: 'create', path: outsideFile, file_text: 'hello' }) },
      { type: 'finish' },
    ]);

    const conversation = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: llm,
      tools: [fileEditor],
      persistenceDir: dir,
    });

    const id = await conversation.startNewConversation();
    await conversation.sendUserMessage('create file');
    const stateAfterRun = (conversation as unknown as { state: ConversationState }).state.snapshot;
    expect(stateAfterRun.status).toBe('WAITING_FOR_CONFIRMATION');
    expect(fs.existsSync(outsideFile)).toBe(false);

    const restoredEvents: Event[] = [];
    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: new MockLLM([{ type: 'finish' }]),
      tools: [fileEditor],
      persistenceDir: dir,
    });
    restored.on('event', (e) => restoredEvents.push(e));
    restored.restoreConversation(id!);

    const before = restoredEvents.length;
    await restored.approveAction();
    const newEvents = restoredEvents.slice(before);

    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('hello');
    const observation = newEvents.find((e) => isObservationEvent(e) && e.tool_name === 'file_editor');
    expect(observation).toBeDefined();
  });

  it('emits a diagnostic when restoring a WAITING_FOR_CONFIRMATION snapshot without a matching ActionEvent', () => {
    const dir = makeTempDir('local-missing-action-');
    const workspaceRoot = makeTempDir('local-workspace-');

    const conversationId = 'local-missing-action';
    const store = new FileStore({ rootDir: dir, conversationId });
    store.writeState({ status: 'WAITING_FOR_CONFIRMATION', iteration: 0, values: {} });
    store.appendEvent({ kind: 'PauseEvent', source: 'agent' } as Event);

    const restoredEvents: Event[] = [];
    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: new MockLLM([{ type: 'finish' }]),
      persistenceDir: dir,
    });
    restored.on('event', (e) => restoredEvents.push(e));
    restored.restoreConversation(conversationId);

    const diagnostic = restoredEvents.find(
      (event) => event.kind === 'ConversationStateUpdateEvent' && (event as unknown as { key?: unknown }).key === 'restore_pending_confirmation',
    );
    expect(diagnostic).toBeDefined();

    const restoredState = (restored as unknown as { state: ConversationState }).state.snapshot;
    expect(restoredState.status).toBe('IDLE');

    const restoreError = restoredEvents.find(
      (event) =>
        event.kind === 'ConversationErrorEvent' &&
        (event as unknown as { code?: unknown }).code === 'restore_pending_confirmation_failed',
    );
    expect(restoreError).toBeDefined();
  });

  it('clears stale WAITING_FOR_CONFIRMATION snapshots when the tool call is already resolved', () => {
    const dir = makeTempDir('local-stale-waiting-');
    const workspaceRoot = makeTempDir('local-workspace-');

    const conversationId = 'local-stale-waiting';
    const store = new FileStore({ rootDir: dir, conversationId });
    store.writeState({ status: 'WAITING_FOR_CONFIRMATION', iteration: 0, values: {} });
    store.appendEvent({
      kind: 'ActionEvent',
      source: 'agent',
      thought: [],
      action: { command: 'echo', value: 'hi' },
      tool_name: 'echo',
      tool_call_id: 'call_1',
    } as Event);
    store.appendEvent({ kind: 'PauseEvent', source: 'agent' } as Event);
    store.appendEvent({
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { echoed: 'hi' },
      tool_name: 'echo',
      tool_call_id: 'call_1',
      action_id: 'action_1',
    } as Event);

    const restoredEvents: Event[] = [];
    const restored = new LocalConversation({
      settings: baseSettings,
      workspaceRoot,
      llmClient: new MockLLM([{ type: 'finish' }]),
      persistenceDir: dir,
    });
    restored.on('event', (e) => restoredEvents.push(e));
    restored.restoreConversation(conversationId);

    const diagnostic = restoredEvents.find(
      (event) => event.kind === 'ConversationStateUpdateEvent' && (event as unknown as { key?: unknown }).key === 'restore_pending_confirmation',
    );
    expect(diagnostic).toBeDefined();

    const restoredState = (restored as unknown as { state: ConversationState }).state.snapshot;
    expect(restoredState.status).toBe('IDLE');

    const restoreError = restoredEvents.find(
      (event) =>
        event.kind === 'ConversationErrorEvent' &&
        (event as unknown as { code?: unknown }).code === 'restore_pending_confirmation_failed',
    );
    expect(restoreError).toBeUndefined();
  });
});

describe('FileStore advanced features', () => {
  it('lists all conversations in a directory', () => {
    const dir = makeTempDir('list-conversations-');

    // Create multiple conversations
    new FileStore({ rootDir: dir, conversationId: 'conv-1' });
    new FileStore({ rootDir: dir, conversationId: 'conv-2' });
    new FileStore({ rootDir: dir, conversationId: 'conv-3' });

    const conversations = FileStore.listConversations(dir);
    expect(conversations).toContain('conv-1');
    expect(conversations).toContain('conv-2');
    expect(conversations).toContain('conv-3');
    expect(conversations).toHaveLength(3);
  });

  it('returns empty array when directory does not exist', () => {
    const conversations = FileStore.listConversations('/nonexistent-directory-12345');
    expect(conversations).toEqual([]);
  });

  it('handles corrupted state file gracefully', () => {
    const dir = makeTempDir('corrupted-state-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-corrupted' });

    // Write valid state first
    persistence.writeState({ status: 'running', iteration: 1, values: {} });

    // Corrupt the state file
    const stateFile = path.join(dir, 'conv-corrupted', 'state.json');
    fs.writeFileSync(stateFile, '{ invalid json }', 'utf8');

    // Should return undefined and not throw
    const state = persistence.readState();
    expect(state).toBeUndefined();
  });

  it('tolerates corrupted event lines', () => {
    const dir = makeTempDir('corrupted-events-');
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-events' });

    // Add valid events
    const event1: Event = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    };
    const event2: Event = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'bye' }] },
    };
    persistence.appendEvent(event1);
    persistence.appendEvent(event2);

    // Corrupt the events file by adding invalid JSON
    const eventsFile = path.join(dir, 'conv-events', 'events.jsonl');
    fs.appendFileSync(eventsFile, '{ invalid json line }\n', 'utf8');

    // Should skip corrupted line and return valid events
    const events = persistence.readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].llm_message).toBeDefined();
    expect(events[1].llm_message).toBeDefined();
  });

  it('handles multiple conversations in the same root directory', () => {
    const dir = makeTempDir('multi-conversation-');

    const persistence1 = new FileStore({ rootDir: dir, conversationId: 'conv-a' });
    const persistence2 = new FileStore({ rootDir: dir, conversationId: 'conv-b' });

    const event1: Event = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'message A' }] },
    };
    const event2: Event = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'message B' }] },
    };

    persistence1.appendEvent(event1);
    persistence2.appendEvent(event2);

    const events1 = persistence1.readEvents();
    const events2 = persistence2.readEvents();

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(((events1[0] as MessageEvent).llm_message.content[0] as TextContent).text).toBe('message A');
    expect(((events2[0] as MessageEvent).llm_message.content[0] as TextContent).text).toBe('message B');
  });
});

describe('Persistence attachment', () => {
  it('attaches persistence to EventLog after creation', () => {
    const dir = makeTempDir('attach-eventlog-');
    const log = new EventLog();

    // Push event without persistence
    log.push({
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'before' }] },
    } as Event);

    // Attach persistence
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-attach' });
    log.attachPersistence(persistence);

    // Push event with persistence
    log.push({
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'after' }] },
    } as Event);

    // Only the second event should be persisted
    const events = persistence.readEvents();
    expect(events).toHaveLength(1);
    expect(((events[0] as MessageEvent).llm_message.content[0] as TextContent).text).toBe('after');
  });

  it('attaches persistence to ConversationState after creation', () => {
    const dir = makeTempDir('attach-state-');
    const log = new EventLog();
    const state = new ConversationState({ eventLog: log });

    // Set value without persistence
    state.setValue('key1', 'value1');

    // Attach persistence
    const persistence = new FileStore({ rootDir: dir, conversationId: 'conv-state' });
    state.attachPersistence(persistence);

    // Set value with persistence
    state.setValue('key2', 'value2');

    // State should have both values
    const snapshot = persistence.readState();
    expect(snapshot?.values.key1).toBe('value1');
    expect(snapshot?.values.key2).toBe('value2');
  });
});
