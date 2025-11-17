import { describe, expect, it } from 'vitest';
import { AnthropicClient } from './anthropic';
import { LLMFactory } from './factory';

describe('LLMFactory', () => {
  it('detects anthropic provider from baseUrl', async () => {
    const factory = new LLMFactory({
      model: 'claude-3-5-sonnet-latest',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
    });

    const client = await factory.createClient();
    expect(client).toBeInstanceOf(AnthropicClient);
  });
});
