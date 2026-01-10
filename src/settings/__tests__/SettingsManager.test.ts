import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveProfile } from '@openhands/agent-sdk-ts';
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
  const originalOpenaiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenaiKey;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGeminiKey;
  });
  let a: MemoryAdapter;
  let mgr: SettingsManager;
  let tmpDir = '';

  beforeEach(async () => {
    a = new MemoryAdapter();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-settings-'));
    mgr = new SettingsManager(a, tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    tmpDir = '';
  });

  it('returns defaults when unset', async () => {
    const s = await mgr.get();
    expect(s.serverUrl).toBeUndefined();
    expect(s.llm.profileId).toBe('sonnet-45');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('sonnet-45');
    expect(s.llm.provider).toBe('anthropic');
    expect(s.llm.openaiApiMode).toBeUndefined();
    expect(s.llm.reasoningSummary).toBeUndefined();
    // Local mode requires a default model for the local Agent to run.
    expect(s.llm.model).toBe('claude-sonnet-4-20250514');
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
    expect(s.agent.debug).toBe(false);
    expect(s.hal.enabled).toBe(false);
    expect(s.hal.mode).toBe('tts_only');
    expect(s.hal.llmProfileId).toBe('gemini-flash-hal');
    expect(s.hal.userName).toBe('Engel');
    expect(s.hal.voiceAId).toBeUndefined();
    expect(s.hal.voiceUserId).toBeUndefined();
    expect(s.hal.modelId).toBeUndefined();
    expect(s.hal.volume).toBe(1);
    expect(s.hal.cache).toBe(true);
  });

  it('selects gpt-5-mini when OPENAI_API_KEY is present', async () => {
    a.secrets.set('OPENAI_API_KEY', 'sk-test');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('gpt-5-mini');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('gpt-5-mini');
  });

  it('selects gpt-5 when a per-profile api key is present', async () => {
    a.secrets.set('openhands.llmProfileApiKey.gpt-5', 'sk-profile');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('gpt-5');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('gpt-5');
  });

  it('prefers per-profile api keys over provider api keys', async () => {
    a.secrets.set('OPENAI_API_KEY', 'sk-provider');
    a.secrets.set('openhands.llmProfileApiKey.sonnet-45', 'sk-profile');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('sonnet-45');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('sonnet-45');
  });

  it('does not overwrite an explicitly configured profileId', async () => {
    a.cfg.set('openhands.llm.profileId', 'gpt-5');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('gpt-5');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('gpt-5');
  });

  it('loads effective LLM settings from the selected profile', async () => {
    saveProfile('custom', {
      provider: 'openai',
      model: 'gpt-5-mini',
      baseUrl: 'https://api.openai.com/v1',
      timeoutSeconds: 12,
      maxInputTokens: 4096.7,
      maxOutputTokens: 2048.3,
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
    }, { rootDir: tmpDir, includeSecrets: false });

    a.cfg.set('openhands.llm.profileId', 'custom');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('custom');
    expect(s.llm.provider).toBe('openai');
    expect(s.llm.model).toBe('gpt-5-mini');
    expect(s.llm.baseUrl).toBe('https://api.openai.com/v1');
    expect(s.llm.timeout).toBe(12);
    expect(s.llm.maxInputTokens).toBe(4096);
    expect(s.llm.maxOutputTokens).toBe(2048);
    expect(s.llm.reasoningSummary).toBe('detailed');
  });

  it('treats an explicitly cleared profileId as unset', async () => {
    a.cfg.set('openhands.llm.profileId', '');
    const s = await mgr.get();
    expect(s.llm.profileId).toBe('sonnet-45');
    expect(a.cfg.get('openhands.llm.profileId')).toBe('sonnet-45');
  });

  it('includes a default model in remote mode', async () => {
    const defaults = await mgr.get();
    await mgr.update({ serverUrl: 'http://example:1234' });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.model).toBe(defaults.llm.model);
  });

  it('normalizes saved servers', async () => {
    a.cfg.set('openhands.servers', [
      { url: ' http://localhost:3000 ', label: '   ' },
      { url: '   ' },
      { url: 'https://example.com:1234', label: ' My Server ' },
    ]);

    const s = await mgr.get();
    expect(s.servers).toEqual([
      { url: 'http://localhost:3000' },
      { url: 'https://example.com:1234', label: 'My Server' },
    ]);
  });

  it('updates and persists config and secrets', async () => {
    await mgr.update({
      serverUrl: 'http://example:1234',
      llm: {
        profileId: 'gpt-5',
      },
      agent: { enableSecurityAnalyzer: true, debug: true },
      conversation: { maxIterations: 42 },
      confirmation: { policy: 'risky', riskyThreshold: 'MEDIUM', confirmUnknown: false },
      hal: {
        enabled: true,
        mode: 'voice_confirm',
        llmProfileId: 'gemini-flash-hal',
        userName: 'Alice',
        voiceAId: 'voice_hal',
        voiceUserId: 'voice_user',
        modelId: 'eleven_turbo_v2',
        volume: 0.25,
        cache: false,
      },
      secrets: { sessionApiKey: 'sess', llmApiKey: 'key' }
    });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.profileId).toBe('gpt-5');
    expect(s.llm.provider).toBe('openai');
    expect(s.llm.model).toBe('gpt-5');
    expect(s.llm.baseUrl).toBe('https://api.openai.com/v1');
    expect(s.llm.inputCostPerToken).toBeUndefined();
    expect(s.llm.outputCostPerToken).toBeUndefined();
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
    expect(s.agent.debug).toBe(true);
    expect(s.conversation.maxIterations).toBe(42);
    expect(s.confirmation.policy).toBe('risky');
    expect(s.confirmation.riskyThreshold).toBe('MEDIUM');
    expect(s.confirmation.confirmUnknown).toBe(false);
    expect(s.hal.enabled).toBe(true);
    expect(s.hal.mode).toBe('voice_confirm');
    expect(s.hal.llmProfileId).toBe('gemini-flash-hal');
    expect(s.hal.userName).toBe('Alice');
    expect(s.hal.voiceAId).toBe('voice_hal');
    expect(s.hal.voiceUserId).toBe('voice_user');
    expect(s.hal.modelId).toBe('eleven_turbo_v2');
    expect(s.hal.volume).toBe(0.25);
    expect(s.hal.cache).toBe(false);
    expect(s.secrets.sessionApiKey).toBe('sess');
    expect(s.secrets.llmApiKey).toBe('key');
    // HAL voice_confirm does not have a separate Gemini secret setting; it relies on profile/provider/global keys.
  });

  it('sanitizes invalid HAL mode and clamps volume', async () => {
    await mgr.update({
      hal: {
        mode: 'wat' as any,
        userName: '   ' as any,
        volume: 2 as any,
      } as any,
    });

    const s = await mgr.get();
    expect(s.hal.mode).toBe('tts_only');
    expect(s.hal.userName).toBe('Engel');
    expect(s.hal.volume).toBe(1);

    await mgr.update({
      hal: { volume: -1 as any } as any,
    });

    const s2 = await mgr.get();
    expect(s2.hal.volume).toBe(0);
  });

  it('clears secrets when undefined is provided', async () => {
    await mgr.update({ secrets: { llmApiKey: 'abc' } });
    let s = await mgr.get();
    expect(s.secrets.llmApiKey).toBe('abc');
    await mgr.update({ secrets: { llmApiKey: undefined } });
    s = await mgr.get();
    expect(s.secrets.llmApiKey).toBeUndefined();
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
        halTtsApiKey: 'xi-example123',
        customSecret1: 'secret-1',
        customSecret2: 'secret-2',
        customSecret3: 'secret-3',
      }
    });

    const s = await mgr.get();
    expect(s.secrets.githubToken).toBe('ghp_example123');
    expect(s.secrets.halTtsApiKey).toBe('xi-example123');
    expect(s.secrets.customSecret1).toBe('secret-1');
    expect(s.secrets.customSecret2).toBe('secret-2');
    expect(s.secrets.customSecret3).toBe('secret-3');
  });

  it('clears GitHub token and custom secrets when undefined is provided', async () => {
    await mgr.update({
      secrets: {
        githubToken: 'ghp_example123',
        halTtsApiKey: 'xi-example123',
        customSecret1: 'secret-1',
        customSecret2: 'secret-2',
        customSecret3: 'secret-3',
      }
    });

    let s = await mgr.get();
    expect(s.secrets.githubToken).toBe('ghp_example123');
    expect(s.secrets.halTtsApiKey).toBe('xi-example123');
    expect(s.secrets.customSecret1).toBe('secret-1');
    expect(s.secrets.customSecret2).toBe('secret-2');
    expect(s.secrets.customSecret3).toBe('secret-3');

    await mgr.update({
      secrets: {
        githubToken: undefined,
        halTtsApiKey: undefined,
        customSecret1: undefined,
        customSecret2: undefined,
        customSecret3: undefined,
      }
    });

    s = await mgr.get();
    expect(s.secrets.githubToken).toBeUndefined();
    expect(s.secrets.halTtsApiKey).toBeUndefined();
    expect(s.secrets.customSecret1).toBeUndefined();
    expect(s.secrets.customSecret2).toBeUndefined();
    expect(s.secrets.customSecret3).toBeUndefined();
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
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
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
