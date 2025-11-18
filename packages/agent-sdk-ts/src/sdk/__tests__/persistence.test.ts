import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { LocalConversation } from '../conversation';
import { ConversationState, EventLog, FileStore } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import type { Event } from '../types';
import type { OpenHandsSettings } from '../types/settings';

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
    expect((events1[0] as any).llm_message.content[0].text).toBe('message A');
    expect((events2[0] as any).llm_message.content[0].text).toBe('message B');
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
    expect((events[0] as any).llm_message.content[0].text).toBe('after');
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
