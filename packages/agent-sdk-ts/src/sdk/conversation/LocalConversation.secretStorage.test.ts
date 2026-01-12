import { describe, expect, it, vi } from 'vitest';
import type { Event, SecretStorage, SecretStorageChangeEvent } from 'vscode';
import type { ChatCompletionRequest, LLMClient } from '../llm';
import type { OpenHandsSettings } from '../types/settings';

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
      if (key !== 'sk-storage') {
        throw new Error(`Expected SecretStorage to supply OPENAI_API_KEY; got '${key ?? ''}'`);
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
  it('passes secretStorage into the default SecretRegistry when secrets is omitted', async () => {
    const getSpy = vi.fn((key: string) => Promise.resolve(key === 'OPENAI_API_KEY' ? 'sk-storage' : undefined));

    const onDidChange: Event<SecretStorageChangeEvent> = () => ({ dispose: () => {} });
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

    await conversation.sendUserMessage('hi');
    expect(getSpy).toHaveBeenCalledWith('OPENAI_API_KEY');
  });
});
