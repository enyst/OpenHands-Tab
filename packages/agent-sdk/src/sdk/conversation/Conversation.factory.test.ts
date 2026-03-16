import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEditorTool } from '../../tools';
import { isAgentServerWorkspace, Workspace } from '../../workspace';
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

  it('returns RemoteConversation when given a remote workspace', () => {
    const conversation = Conversation({
      settings: baseSettings,
      workspace: Workspace({ kind: 'remote', serverUrl: 'http://localhost:3000', workingDir: '/workspace/project' }),
    });
    expect(conversation.mode).toBe('remote');
    expect(conversation).toBeInstanceOf(RemoteConversation);
  });

  it('does not treat plain remote workspace payloads as runtime workspaces', () => {
    expect(isAgentServerWorkspace({ kind: 'remote', working_dir: '/workspace/project' })).toBe(false);
  });

  it('keeps auth fresh on the serverUrl factory path when settings change', async () => {
    let uploadCalls = 0;
    const fetchMock = vi.fn((url: string, init?: { headers?: Record<string, string>; method?: string }) => {
      if (url.includes('/api/file/upload')) {
        expect(init?.method).toBe('POST');
        uploadCalls += 1;
        expect(init?.headers?.['X-Session-API-Key']).toBe(uploadCalls === 1 ? 'session-key-1' : 'session-key-2');
        return Promise.resolve(new Response('', { status: 200 }));
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const conversation = Conversation({
      serverUrl: 'http://localhost:3000',
      settings: { ...baseSettings, secrets: { runtimeSessionApiKey: 'session-key-1' } },
      workspaceRoot: '/workspace',
    });

    expect(conversation).toBeInstanceOf(RemoteConversation);
    const remoteConversation = conversation as RemoteConversation;
    const workspace1 = remoteConversation.getWorkspace();

    await workspace1.writeFile('notes.txt', 'hello');

    remoteConversation.setSettings({
      ...baseSettings,
      secrets: { runtimeSessionApiKey: 'session-key-2' },
    });
    const workspace2 = remoteConversation.getWorkspace();
    expect(workspace2).not.toBe(workspace1);

    await workspace2.writeFile('notes.txt', 'hello');
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
