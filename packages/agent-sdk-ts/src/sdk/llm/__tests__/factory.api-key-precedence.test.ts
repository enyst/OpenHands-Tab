import { describe, expect, it } from 'vitest';
import { LLMFactory } from '..';
import { SecretRegistry } from '../../runtime/SecretRegistry';

class TrackingSecretRegistry extends SecretRegistry {
  readonly calls: string[] = [];

  async get(name: string): Promise<string | undefined> {
    this.calls.push(name);
    return super.get(name);
  }
}

describe('LLMFactory API key precedence', () => {
  it('prefers provider-specific key over openhands.llmApiKey (openai)', async () => {
    const secrets = new TrackingSecretRegistry();
    secrets.set('openhands.llmApiKey', 'sk-global');
    secrets.set('OPENAI_API_KEY', 'sk-openai');

    const factory = new LLMFactory({ provider: 'openai', model: 'gpt-5-mini' }, { secrets });
    await factory.createClient();

    expect(secrets.calls).toEqual(['OPENAI_API_KEY']);
  });

  it('prefers provider-specific key over openhands.llmApiKey (litellm_proxy)', async () => {
    const secrets = new TrackingSecretRegistry();
    secrets.set('openhands.llmApiKey', 'sk-global');
    secrets.set('LITELLM_API_KEY', 'sk-litellm');

    const factory = new LLMFactory({ provider: 'litellm_proxy', model: 'gpt-4o-mini' }, { secrets });
    await factory.createClient();

    expect(secrets.calls).toEqual(['LITELLM_API_KEY']);
  });

  it('falls back to openhands.llmApiKey when provider key is missing', async () => {
    const secrets = new TrackingSecretRegistry();
    secrets.set('openhands.llmApiKey', 'sk-global');

    const factory = new LLMFactory({ provider: 'openai', model: 'gpt-5-mini' }, { secrets });
    await factory.createClient();

    expect(secrets.calls).toEqual(['OPENAI_API_KEY', 'openhands.llmApiKey']);
  });
});

