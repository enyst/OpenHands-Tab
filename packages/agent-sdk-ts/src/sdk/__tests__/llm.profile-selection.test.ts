import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ConversationStats } from '../runtime/ConversationStats';
import { SecretRegistry } from '../runtime/SecretRegistry';
import { LLMFactory, LLMRegistry, TrackedLLMClient, saveProfile } from '../llm';

const makeTempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('LLMFactory profile selection', () => {
  it('loads config from profileId and exposes a user-facing label', async () => {
    const dir = makeTempDir('llm-profile-selection-');
    try {
      saveProfile('p1', { provider: 'openai', model: 'gpt-5' }, { rootDir: dir });

      const registry = new LLMRegistry();
      const stats = new ConversationStats();
      registry.subscribe((event) => stats.registerLlm(event));

      const factory = new LLMFactory(
        {
          // Placeholder values should not override the profile's provider/model.
          provider: 'anthropic',
          model: 'IGNORED',
          profileId: 'p1',
          profileName: 'My Profile',
          usageId: 'default',
          apiKey: 'sk-inline',
        },
        { registry, profileStoreOptions: { rootDir: dir } },
      );

      const client = await factory.createClient();
      expect(client).toBeInstanceOf(TrackedLLMClient);

      const tracked = client as TrackedLLMClient;
      expect(tracked.modelName).toBe('gpt-5');
      expect(tracked.label).toBe('My Profile');
      expect(stats.usageToLabels.default).toBe('My Profile');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to raw LLM config when profileId is unset', async () => {
    const registry = new LLMRegistry();
    const stats = new ConversationStats();
    registry.subscribe((event) => stats.registerLlm(event));

    const factory = new LLMFactory(
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        usageId: 'default',
        apiKey: 'sk-inline',
      },
      { registry },
    );

    const client = await factory.createClient();
    expect(client).toBeInstanceOf(TrackedLLMClient);
    const tracked = client as TrackedLLMClient;
    expect(tracked.modelName).toBe('gpt-5-mini');
    expect(tracked.label).toBe('gpt-5-mini');
    expect(stats.usageToLabels.default).toBe('gpt-5-mini');
  });

  it('falls back to provider env key when profileId key is missing', async () => {
    const dir = makeTempDir('llm-profile-selection-keys-');
    const originalLlmApiKey = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      saveProfile(
        'p1',
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          profileName: 'Sonnet Profile',
        },
        { rootDir: dir },
      );

      const secrets = new SecretRegistry();
      secrets.set('ANTHROPIC_API_KEY', 'sk-anthropic');

      const factory = new LLMFactory(
        {
          provider: 'openai',
          model: 'IGNORED',
          profileId: 'p1',
          usageId: 'default',
        },
        {
          secrets,
          preferredApiKeys: ['openhands.llmProfileApiKey.p1'],
          profileStoreOptions: { rootDir: dir },
        },
      );

      const client = await factory.createClient();
      expect(client).toBeInstanceOf(TrackedLLMClient);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      if (originalLlmApiKey === undefined) {
        delete process.env.LLM_API_KEY;
      } else {
        process.env.LLM_API_KEY = originalLlmApiKey;
      }
    }
  });
});
