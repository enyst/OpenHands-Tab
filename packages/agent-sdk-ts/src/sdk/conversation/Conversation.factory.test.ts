import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEditorTool } from '../../tools';
import type { Event } from '../types';
import { isActionEvent, isMessageEvent, isObservationEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { Conversation, LocalConversation, RemoteConversation } from './index';

vi.mock('../llm', async () => {
  const actual = await vi.importActual<typeof import('../llm')>('../llm');

  class MockLLMFactory {
    createClient() {
      let callIndex = 0;
      const sequences = [
        [
          { type: 'text', text: 'Creating file' },
          {
            type: 'tool_call_delta',
            id: 'call_1',
            name: 'file_editor',
            arguments: JSON.stringify({ command: 'create', path: 'hello.py', file_text: 'print("Hello, World!")' }),
          },
          { type: 'finish' },
        ],
        [{ type: 'text', text: 'Done' }, { type: 'finish' }],
      ];

      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *streamChat(_request: unknown) {
          void _request;
          const next = sequences[callIndex] ?? [];
          callIndex += 1;
          for (const chunk of next) {
            yield chunk;
          }
        },
      };
    }
  }

  return { ...actual, LLMFactory: MockLLMFactory };
});

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 5 },
  confirmation: {},
  secrets: {},
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('Conversation factory', () => {
  it('returns LocalConversation when serverUrl is omitted', () => {
    const conversation = Conversation({ settings: baseSettings });
    expect(conversation.mode).toBe('local');
    expect(conversation).toBeInstanceOf(LocalConversation);
  });

  it('returns RemoteConversation when serverUrl is provided', () => {
    const conversation = Conversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });
    expect(conversation.mode).toBe('remote');
    expect(conversation).toBeInstanceOf(RemoteConversation);
  });

  it('supports local hello-world tool flow via Conversation()', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-factory-'));
    created.push(workspaceRoot);

    const conversation = Conversation({
      settings: baseSettings,
      workspaceRoot,
      tools: [new FileEditorTool()],
    });

    const events: Event[] = [];
    conversation.on('event', (event: Event) => events.push(event));

    await conversation.sendUserMessage('Create hello.py');

    expect(events.some(isActionEvent)).toBe(true);
    expect(events.some(isObservationEvent)).toBe(true);
    expect(events.some(isMessageEvent)).toBe(true);

    const filePath = path.join(workspaceRoot, 'hello.py');
    const fileContent = await fs.readFile(filePath, 'utf8');
    expect(fileContent).toContain('Hello, World!');
  });
});
