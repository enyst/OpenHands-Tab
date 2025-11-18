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
});
