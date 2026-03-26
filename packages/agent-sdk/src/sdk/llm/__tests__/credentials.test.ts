import { describe, it, expect } from 'vitest';
import { LLMCredentialProvider } from '../credentials';
import { SecretRegistry } from '../../runtime/SecretRegistry';

describe('LLMCredentialProvider', () => {
  describe('constructor', () => {
    it('creates instance with default registry', () => {
      const provider = new LLMCredentialProvider();
      // Should not throw
      expect(provider).toBeDefined();
    });

    it('creates instance with custom registry', () => {
      const registry = new SecretRegistry();
      const provider = new LLMCredentialProvider(registry);
      expect(provider).toBeDefined();
    });
  });

  describe('getApiKey', () => {
    it('returns undefined when no keys are registered', async () => {
      // This test must be hermetic: some dev environments may have LLM_API_KEY set.
      const prev = process.env.LLM_API_KEY;
      delete process.env.LLM_API_KEY;

      try {
        const registry = new SecretRegistry();
        const provider = new LLMCredentialProvider(registry);

        const key = await provider.getApiKey();
        expect(key).toBe(undefined);
      } finally {
        if (prev !== undefined) {
          process.env.LLM_API_KEY = prev;
        } else {
          delete process.env.LLM_API_KEY;
        }
      }
    });

    it('returns key from openhands.llmApiKey', async () => {
      const registry = new SecretRegistry();
      await registry.set('openhands.llmApiKey', 'my-api-key');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey();
      expect(key).toBe('my-api-key');
    });

    it('returns key from LLM_API_KEY fallback', async () => {
      const registry = new SecretRegistry();
      await registry.set('LLM_API_KEY', 'fallback-key');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey();
      expect(key).toBe('fallback-key');
    });

    it('prefers openhands.llmApiKey over LLM_API_KEY', async () => {
      const registry = new SecretRegistry();
      await registry.set('openhands.llmApiKey', 'primary-key');
      await registry.set('LLM_API_KEY', 'fallback-key');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey();
      expect(key).toBe('primary-key');
    });

    it('uses preferred key as string when provided', async () => {
      const registry = new SecretRegistry();
      await registry.set('custom.apiKey', 'custom-value');
      await registry.set('openhands.llmApiKey', 'default-value');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey('custom.apiKey');
      expect(key).toBe('custom-value');
    });

    it('uses preferred keys as array when provided', async () => {
      const registry = new SecretRegistry();
      await registry.set('custom.second', 'second-value');
      await registry.set('openhands.llmApiKey', 'default-value');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey(['custom.first', 'custom.second']);
      expect(key).toBe('second-value');
    });

    it('falls back to defaults when preferred keys not found', async () => {
      const registry = new SecretRegistry();
      await registry.set('openhands.llmApiKey', 'default-value');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey(['nonexistent.key']);
      expect(key).toBe('default-value');
    });

    it('respects priority order of preferred keys', async () => {
      const registry = new SecretRegistry();
      await registry.set('first.key', 'first-value');
      await registry.set('second.key', 'second-value');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey(['first.key', 'second.key']);
      expect(key).toBe('first-value');
    });

    it('returns first available key in order', async () => {
      const registry = new SecretRegistry();
      await registry.set('second.key', 'second-value');
      const provider = new LLMCredentialProvider(registry);

      const key = await provider.getApiKey(['first.key', 'second.key', 'third.key']);
      expect(key).toBe('second-value');
    });
  });
});
