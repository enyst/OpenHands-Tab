import { describe, it, expect } from 'vitest';
import { SettingsManager } from '../SettingsManager';
import type { SettingsAdapter } from '../SettingsAdapter';

class MemoryAdapter implements SettingsAdapter {
  cfg = new Map<string, any>();
  secrets = new Map<string, string>();
  get<T>(key: string, def?: T): T | undefined { return this.cfg.has(key) ? this.cfg.get(key) : def; }
  getExplicit<T>(key: string): T | undefined { return this.cfg.has(key) ? this.cfg.get(key) : undefined; }
  async update<T>(key: string, value: T): Promise<void> { this.cfg.set(key, value as any); }
  async getSecret(key: string): Promise<string | undefined> { return this.secrets.get(key); }
  async storeSecret(key: string, value: string | undefined): Promise<void> {
    if (!value) this.secrets.delete(key); else this.secrets.set(key, value);
  }
}

describe('SettingsManager', () => {
  it('returns defaults when unset', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://localhost:3000');
    expect(s.llm.usageId).toBeUndefined();
    expect(s.agent.enableSecurityAnalyzer).toBe(false);
  });

  it('updates and persists config and secrets', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);
    await mgr.update({
      serverUrl: 'http://example:1234',
      llm: { usageId: 'my-usage', model: 'foo', baseUrl: 'https://api.example.com' },
      agent: { enableSecurityAnalyzer: true },
      conversation: { maxIterations: 42 },
      confirmation: { policy: 'risky', riskyThreshold: 'MEDIUM', confirmUnknown: false },
      secrets: { sessionApiKey: 'sess', llmApiKey: 'key' }
    });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.usageId).toBe('my-usage');
    expect(s.llm.model).toBe('foo');
    expect(s.llm.baseUrl).toBe('https://api.example.com');
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
    expect(s.conversation.maxIterations).toBe(42);
    expect(s.confirmation.policy).toBe('risky');
    expect(s.confirmation.riskyThreshold).toBe('MEDIUM');
    expect(s.confirmation.confirmUnknown).toBe(false);
    expect(s.secrets.sessionApiKey).toBe('sess');
    expect(s.secrets.llmApiKey).toBe('key');
  });

  it('clears secret when undefined is provided', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);
    await mgr.update({ secrets: { llmApiKey: 'abc' } });
    let s = await mgr.get();
    expect(s.secrets.llmApiKey).toBe('abc');
    await mgr.update({ secrets: { llmApiKey: undefined } });
    s = await mgr.get();
    expect(s.secrets.llmApiKey).toBeUndefined();
  });

  it('updates AWS credentials', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    await mgr.update({
      secrets: {
        awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        awsSecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      }
    });

    const s = await mgr.get();
    expect(s.secrets.awsAccessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(s.secrets.awsSecretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  it('clears AWS credentials when undefined is provided', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    await mgr.update({
      secrets: {
        awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        awsSecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      }
    });

    let s = await mgr.get();
    expect(s.secrets.awsAccessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(s.secrets.awsSecretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');

    await mgr.update({
      secrets: {
        awsAccessKeyId: undefined,
        awsSecretAccessKey: undefined
      }
    });

    s = await mgr.get();
    expect(s.secrets.awsAccessKeyId).toBeUndefined();
    expect(s.secrets.awsSecretAccessKey).toBeUndefined();
  });

  it('updates all optional LLM fields', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    await mgr.update({
      llm: {
        apiVersion: '2024-01-01',
        timeout: 120,
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        maxInputTokens: 4096,
        maxOutputTokens: 2048,
        nativeToolCalling: true,
        reasoningEffort: 'high'
      }
    });

    const s = await mgr.get();
    expect(s.llm.apiVersion).toBe('2024-01-01');
    expect(s.llm.timeout).toBe(120);
    expect(s.llm.temperature).toBe(0.7);
    expect(s.llm.topP).toBe(0.9);
    expect(s.llm.topK).toBe(50);
    expect(s.llm.maxInputTokens).toBe(4096);
    expect(s.llm.maxOutputTokens).toBe(2048);
    expect(s.llm.nativeToolCalling).toBe(true);
    expect(s.llm.reasoningEffort).toBe('high');
  });

  it('handles sanitizePositiveInteger with invalid inputs', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    // Test with invalid maxInputTokens and maxOutputTokens
    await mgr.update({
      llm: {
        maxInputTokens: -100 as any, // Should be filtered out
        maxOutputTokens: 0 as any, // Should be filtered out
      }
    });

    const s = await mgr.get();
    expect(s.llm.maxInputTokens).toBeUndefined();
    expect(s.llm.maxOutputTokens).toBeUndefined();
  });

  it('handles sanitizePositiveInteger with fractional numbers', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    await mgr.update({
      llm: {
        maxInputTokens: 4096.7 as any, // Should be truncated to 4096
        maxOutputTokens: 2048.3 as any, // Should be truncated to 2048
      }
    });

    const s = await mgr.get();
    expect(s.llm.maxInputTokens).toBe(4096);
    expect(s.llm.maxOutputTokens).toBe(2048);
  });

  it('handles null returns from adapter.get by falling back to defaults', async () => {
    const a = new MemoryAdapter();
    // Override get to return null for specific keys
    const originalGet = a.get.bind(a);
    a.get = <T>(key: string, def?: T): T | undefined => {
      if (key === 'openhands.serverUrl') return null as any;
      if (key === 'openhands.agent.enableSecurityAnalyzer') return null as any;
      if (key === 'openhands.conversation.maxIterations') return null as any;
      if (key === 'openhands.confirmation.policy') return null as any;
      if (key === 'openhands.confirmation.risky.threshold') return null as any;
      if (key === 'openhands.confirmation.risky.confirmUnknown') return null as any;
      return originalGet(key, def);
    };

    const mgr = new SettingsManager(a);
    const s = await mgr.get();

    expect(s.serverUrl).toBe('http://localhost:3000');
    expect(s.agent.enableSecurityAnalyzer).toBe(false);
    expect(s.conversation.maxIterations).toBe(50);
    expect(s.confirmation.policy).toBe('never');
    expect(s.confirmation.riskyThreshold).toBe('HIGH');
    expect(s.confirmation.confirmUnknown).toBe(true);
  });

  it('updates settings with global target', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);

    await mgr.update({ serverUrl: 'http://global:5000' }, 'global');

    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://global:5000');
  });
});
