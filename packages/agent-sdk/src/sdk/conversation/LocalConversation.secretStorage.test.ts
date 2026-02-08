import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event as VsCodeEvent, SecretStorage, SecretStorageChangeEvent } from 'vscode';
import type { ChatCompletionRequest, LLMClient } from '../llm';
import type { OpenHandsSettings } from '../types/settings';
import type { ConversationErrorEvent, Event as SdkEvent } from '../types';
import { isConversationErrorEvent, isMessageEvent } from '../types';

let expectedOpenAiKey: string | undefined = 'sk-storage';

vi.mock('../llm', async () => {
  const actual = await vi.importActual<typeof import('../llm')>('../llm');

  class MockLLMFactory {
    constructor(
      _config: unknown,
      private readonly options: { secrets: { get: (name: string) => Promise<string | undefined> } },
    ) {
      void _config;
    }

    async createClient(): Promise<LLMClient> {
      const key = await this.options.secrets.get('OPENAI_API_KEY');
      if (key !== expectedOpenAiKey) {
        throw new Error(`Expected OPENAI_API_KEY '${expectedOpenAiKey ?? ''}'; got '${key ?? ''}'`);
      }

      return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *streamChat(_request: ChatCompletionRequest) {
          void _request;
          yield { type: 'finish' };
        },
      };
    }
  }

  return { ...actual, LLMFactory: MockLLMFactory };
});

import { LocalConversation } from './LocalConversation';

const baseSettings: OpenHandsSettings = {
  llm: { provider: 'openai', model: 'gpt-5-mini' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

describe('LocalConversation SecretStorage wiring', () => {
  const previousEnv: string | undefined = process.env['OPENAI_API_KEY'];

  beforeEach(() => {
    expectedOpenAiKey = 'sk-storage';
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = previousEnv;
    }
  });

  it('passes secretStorage into the default SecretRegistry when secrets is omitted', async () => {
    const getSpy = vi.fn((key: string) => Promise.resolve(key === 'OPENAI_API_KEY' ? 'sk-storage' : undefined));

    const onDidChange: VsCodeEvent<SecretStorageChangeEvent> = () => ({ dispose: () => {} });
    const secretStorage: SecretStorage = {
      get: getSpy,
      store: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      onDidChange,
    };

    const conversation = new LocalConversation({
      settings: baseSettings,
      secretStorage,
      tools: [],
    });

    const events: Array<ConversationErrorEvent> = [];
    conversation.on('event', (event: SdkEvent) => {
      if (isConversationErrorEvent(event)) {
        events.push(event);
      }
    });

    await expect(conversation.sendUserMessage('hi')).resolves.toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith('OPENAI_API_KEY');
    expect(events).toHaveLength(0);
  });

  it('falls back to env when SecretStorage returns undefined', async () => {
    expectedOpenAiKey = 'sk-env';
    process.env['OPENAI_API_KEY'] = 'sk-env';

    const getSpy = vi.fn(() => Promise.resolve(undefined));
    const onDidChange: VsCodeEvent<SecretStorageChangeEvent> = () => ({ dispose: () => {} });
    const secretStorage: SecretStorage = {
      get: getSpy,
      store: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      onDidChange,
    };

    const conversation = new LocalConversation({
      settings: baseSettings,
      secretStorage,
      tools: [],
    });

    const errorEvents: ConversationErrorEvent[] = [];
    const messageEvents: SdkEvent[] = [];
    conversation.on('event', (event: SdkEvent) => {
      if (isConversationErrorEvent(event)) errorEvents.push(event);
      if (isMessageEvent(event)) messageEvents.push(event);
    });

    await expect(conversation.sendUserMessage('hi')).resolves.toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith('OPENAI_API_KEY');
    expect(errorEvents).toHaveLength(0);
    expect(messageEvents.length).toBeGreaterThan(0);
  });

  it('emits a ConversationErrorEvent when SecretStorage.get throws', async () => {
    expectedOpenAiKey = undefined;
    delete process.env['OPENAI_API_KEY'];

    const getSpy = vi.fn(() => Promise.reject(new Error('kaboom')));
    const onDidChange: VsCodeEvent<SecretStorageChangeEvent> = () => ({ dispose: () => {} });
    const secretStorage: SecretStorage = {
      get: getSpy,
      store: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      onDidChange,
    };

    const conversation = new LocalConversation({
      settings: baseSettings,
      secretStorage,
      tools: [],
    });

    const errorEvents: ConversationErrorEvent[] = [];
    conversation.on('event', (event: SdkEvent) => {
      if (isConversationErrorEvent(event)) errorEvents.push(event);
    });

    await expect(conversation.sendUserMessage('hi')).resolves.toBeUndefined();
    expect(getSpy).toHaveBeenCalledWith('OPENAI_API_KEY');
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents.some((e) => (e.detail ?? '').includes('kaboom'))).toBe(true);
  });
});
