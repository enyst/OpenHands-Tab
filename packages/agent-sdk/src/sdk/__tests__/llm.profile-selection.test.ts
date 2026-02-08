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
          usageId: 'default',
          apiKeyRef: { kind: 'inline', value: 'sk-inline' },
        },
        { registry, profileStoreOptions: { rootDir: dir } },
      );

      const client = await factory.createClient();
      expect(client).toBeInstanceOf(TrackedLLMClient);

      const tracked = client as TrackedLLMClient;
      expect(tracked.modelName).toBe('gpt-5');
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
        apiKeyRef: { kind: 'inline', value: 'sk-inline' },
      },
      { registry },
    );

    const client = await factory.createClient();
    expect(client).toBeInstanceOf(TrackedLLMClient);
    const tracked = client as TrackedLLMClient;
    expect(tracked.modelName).toBe('gpt-5-mini');
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

  it('keeps main agent usage under a stable usageId when switching profiles', async () => {
    const dir = makeTempDir('llm-profile-switching-usageid-');
    try {
      saveProfile('gpt-5', { provider: 'openai', model: 'gpt-5' }, { rootDir: dir });
      saveProfile('sonnet-45', { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, { rootDir: dir });

      const registry = new LLMRegistry();
      const stats = new ConversationStats();
      registry.subscribe((event) => stats.registerLlm(event));

      const first = await new LLMFactory(
        { provider: 'openai', model: 'IGNORED', profileId: 'gpt-5', usageId: 'agent', apiKeyRef: { kind: 'inline', value: 'sk-inline' } },
        { registry, profileStoreOptions: { rootDir: dir } },
      ).createClient();
      expect(first).toBeInstanceOf(TrackedLLMClient);
      (first as TrackedLLMClient).metrics.addTokenUsage({ promptTokens: 10, completionTokens: 1, responseId: 'r1' });

      const second = await new LLMFactory(
        { provider: 'openai', model: 'IGNORED', profileId: 'sonnet-45', usageId: 'agent', apiKeyRef: { kind: 'inline', value: 'sk-inline' } },
        { registry, profileStoreOptions: { rootDir: dir } },
      ).createClient();
      expect(second).toBeInstanceOf(TrackedLLMClient);
      (second as TrackedLLMClient).metrics.addTokenUsage({ promptTokens: 5, completionTokens: 2, responseId: 'r2' });

      expect(Object.keys(stats.usageToMetrics)).toEqual(['agent']);
      expect(stats.usageToMetrics.agent.accumulatedTokenUsage).toMatchObject({
        promptTokens: 15,
        completionTokens: 3,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
