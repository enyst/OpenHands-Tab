import { describe, it, expect, beforeEach } from 'vitest';
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
  let a: MemoryAdapter;
  let mgr: SettingsManager;

  beforeEach(() => {
    a = new MemoryAdapter();
    mgr = new SettingsManager(a);
  });

  it('returns defaults when unset', async () => {
    const s = await mgr.get();
    expect(s.serverUrl).toBeUndefined();
    expect(s.llm.usageId).toBe('default-llm');
    expect(s.llm.provider).toBe('anthropic');
    // Local mode requires a default model for the local Agent to run.
    expect(s.llm.model).toBe('claude-sonnet-4-20250514');
    expect(s.agent.enableSecurityAnalyzer).toBe(false);
    expect(s.agent.debug).toBe(false);
    expect(s.elevenlabs.enabled).toBe(false);
    expect(s.elevenlabs.mode).toBe('tts_only');
    expect(s.elevenlabs.userName).toBe('Engel');
    expect(s.elevenlabs.voiceAId).toBeUndefined();
    expect(s.elevenlabs.voiceUserId).toBeUndefined();
    expect(s.elevenlabs.modelId).toBeUndefined();
    expect(s.elevenlabs.volume).toBe(1);
    expect(s.elevenlabs.cache).toBe(true);
    expect(s.gemini.model).toBe('gemini-2.5-flash');
    expect(s.gemini.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('includes a default model in remote mode', async () => {
    const defaults = await mgr.get();
    await mgr.update({ serverUrl: 'http://example:1234' });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.model).toBe(defaults.llm.model);
  });

  it('updates and persists config and secrets', async () => {
    await mgr.update({
      serverUrl: 'http://example:1234',
      llm: {
        usageId: 'my-usage',
        provider: 'openrouter',
        model: 'foo',
        baseUrl: 'https://api.example.com',
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
      },
      agent: { enableSecurityAnalyzer: true, debug: true },
      conversation: { maxIterations: 42 },
      confirmation: { policy: 'risky', riskyThreshold: 'MEDIUM', confirmUnknown: false },
      elevenlabs: {
        enabled: true,
        mode: 'voice_confirm',
        userName: 'Alice',
        voiceAId: 'voice_hal',
        voiceUserId: 'voice_user',
        modelId: 'eleven_turbo_v2',
        volume: 0.25,
        cache: false,
      },
      gemini: {
        model: 'gemini-2.5-pro',
        baseUrl: 'https://proxy.example.com/v1beta',
      },
      secrets: { sessionApiKey: 'sess', llmApiKey: 'key', geminiApiKey: 'gemini-key' }
    });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.usageId).toBe('my-usage');
    expect(s.llm.provider).toBe('openrouter');
    expect(s.llm.model).toBe('foo');
    expect(s.llm.baseUrl).toBe('https://api.example.com');
    expect(s.llm.inputCostPerToken).toBe(0.000001);
    expect(s.llm.outputCostPerToken).toBe(0.000002);
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
    expect(s.agent.debug).toBe(true);
    expect(s.conversation.maxIterations).toBe(42);
    expect(s.confirmation.policy).toBe('risky');
    expect(s.confirmation.riskyThreshold).toBe('MEDIUM');
    expect(s.confirmation.confirmUnknown).toBe(false);
    expect(s.elevenlabs.enabled).toBe(true);
    expect(s.elevenlabs.mode).toBe('voice_confirm');
    expect(s.elevenlabs.userName).toBe('Alice');
    expect(s.elevenlabs.voiceAId).toBe('voice_hal');
    expect(s.elevenlabs.voiceUserId).toBe('voice_user');
    expect(s.elevenlabs.modelId).toBe('eleven_turbo_v2');
    expect(s.elevenlabs.volume).toBe(0.25);
    expect(s.elevenlabs.cache).toBe(false);
    expect(s.gemini.model).toBe('gemini-2.5-pro');
    expect(s.gemini.baseUrl).toBe('https://proxy.example.com/v1beta');
    expect(s.secrets.sessionApiKey).toBe('sess');
    expect(s.secrets.llmApiKey).toBe('key');
    expect(s.secrets.geminiApiKey).toBe('gemini-key');
  });

  it('sanitizes invalid ElevenLabs mode and clamps volume', async () => {
    await mgr.update({
      elevenlabs: {
        mode: 'wat' as any,
        userName: '   ' as any,
        volume: 2 as any,
      } as any,
    });

    const s = await mgr.get();
    expect(s.elevenlabs.mode).toBe('tts_only');
    expect(s.elevenlabs.userName).toBe('Engel');
    expect(s.elevenlabs.volume).toBe(1);

    await mgr.update({
      elevenlabs: { volume: -1 as any } as any,
    });

    const s2 = await mgr.get();
    expect(s2.elevenlabs.volume).toBe(0);
  });

  it('clears secrets when undefined is provided', async () => {
    await mgr.update({ secrets: { llmApiKey: 'abc', geminiApiKey: 'g1' } });
    let s = await mgr.get();
    expect(s.secrets.llmApiKey).toBe('abc');
    expect(s.secrets.geminiApiKey).toBe('g1');
    await mgr.update({ secrets: { llmApiKey: undefined, geminiApiKey: undefined } });
    s = await mgr.get();
    expect(s.secrets.llmApiKey).toBeUndefined();
    expect(s.secrets.geminiApiKey).toBeUndefined();
  });

  it('updates AWS credentials', async () => {
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

  it('updates GitHub token and custom secrets', async () => {
    await mgr.update({
      secrets: {
        githubToken: 'ghp_example123',
        elevenLabsApiKey: 'xi-example123',
        customSecret1: 'secret-1',
        customSecret2: 'secret-2',
        customSecret3: 'secret-3',
      }
    });

    const s = await mgr.get();
    expect(s.secrets.githubToken).toBe('ghp_example123');
    expect(s.secrets.elevenLabsApiKey).toBe('xi-example123');
    expect(s.secrets.customSecret1).toBe('secret-1');
    expect(s.secrets.customSecret2).toBe('secret-2');
    expect(s.secrets.customSecret3).toBe('secret-3');
  });

  it('clears GitHub token and custom secrets when undefined is provided', async () => {
    await mgr.update({
      secrets: {
        githubToken: 'ghp_example123',
        elevenLabsApiKey: 'xi-example123',
        customSecret1: 'secret-1',
        customSecret2: 'secret-2',
        customSecret3: 'secret-3',
      }
    });

    let s = await mgr.get();
    expect(s.secrets.githubToken).toBe('ghp_example123');
    expect(s.secrets.elevenLabsApiKey).toBe('xi-example123');
    expect(s.secrets.customSecret1).toBe('secret-1');
    expect(s.secrets.customSecret2).toBe('secret-2');
    expect(s.secrets.customSecret3).toBe('secret-3');

    await mgr.update({
      secrets: {
        githubToken: undefined,
        elevenLabsApiKey: undefined,
        customSecret1: undefined,
        customSecret2: undefined,
        customSecret3: undefined,
      }
    });

    s = await mgr.get();
    expect(s.secrets.githubToken).toBeUndefined();
    expect(s.secrets.elevenLabsApiKey).toBeUndefined();
    expect(s.secrets.customSecret1).toBeUndefined();
    expect(s.secrets.customSecret2).toBeUndefined();
    expect(s.secrets.customSecret3).toBeUndefined();
  });

  it('updates all optional LLM fields', async () => {
    await mgr.update({
      llm: {
        apiVersion: '2024-01-01',
        timeout: 120,
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        maxInputTokens: 4096,
        maxOutputTokens: 2048,
        reasoningEffort: 'high',
        inputCostPerToken: 0.000001,
        outputCostPerToken: 0.000002,
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
    expect(s.llm.reasoningEffort).toBe('high');
    expect(s.llm.inputCostPerToken).toBe(0.000001);
    expect(s.llm.outputCostPerToken).toBe(0.000002);
  });

  it('handles sanitizePositiveInteger with invalid inputs', async () => {
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
    // Override get to return null for specific keys
    const originalGet = a.get.bind(a);
    const nullKeys = new Set([
      'openhands.serverUrl',
      'openhands.agent.enableSecurityAnalyzer',
      'openhands.agent.debug',
      'openhands.conversation.maxIterations',
      'openhands.confirmation.policy',
      'openhands.confirmation.risky.threshold',
      'openhands.confirmation.risky.confirmUnknown',
    ]);
    a.get = <T>(key: string, def?: T): T | undefined => {
      if (nullKeys.has(key)) return null as any;
      return originalGet(key, def);
    };

    const s = await mgr.get();

    expect(s.serverUrl).toBeUndefined();
    expect(s.agent.enableSecurityAnalyzer).toBe(false);
    expect(s.agent.debug).toBe(false);
    expect(s.conversation.maxIterations).toBe(50);
    expect(s.confirmation.policy).toBe('never');
    expect(s.confirmation.riskyThreshold).toBe('MEDIUM');
    expect(s.confirmation.confirmUnknown).toBe(true);
  });

  it('updates settings with global target', async () => {
    await mgr.update({ serverUrl: 'http://global:5000' }, 'global');

    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://global:5000');
  });
});
