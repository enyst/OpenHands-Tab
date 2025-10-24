import { describe, it, expect } from 'vitest';
import { SettingsManager } from '../SettingsManager';
import type { SettingsAdapter } from '../SettingsAdapter';

class MemoryAdapter implements SettingsAdapter {
  cfg = new Map<string, any>();
  secrets = new Map<string, string>();
  get<T>(key: string, def?: T): T | undefined { return this.cfg.has(key) ? this.cfg.get(key) : def; }
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
    expect(s.llm.usageId).toBe('default-llm');
    expect(s.agent.enableSecurityAnalyzer).toBe(false);
  });

  it('updates and persists config and secrets', async () => {
    const a = new MemoryAdapter();
    const mgr = new SettingsManager(a);
    await mgr.update({
      serverUrl: 'http://example:1234',
      llm: { usageId: 'my-usage', model: 'foo', baseUrl: 'https://api.example.com' },
      agent: { enableSecurityAnalyzer: true, filterToolsRegex: '^(BashTool)$' },
      secrets: { sessionApiKey: 'sess', llmApiKey: 'key' }
    });
    const s = await mgr.get();
    expect(s.serverUrl).toBe('http://example:1234');
    expect(s.llm.usageId).toBe('my-usage');
    expect(s.llm.model).toBe('foo');
    expect(s.llm.baseUrl).toBe('https://api.example.com');
    expect(s.agent.enableSecurityAnalyzer).toBe(true);
    expect(s.agent.filterToolsRegex).toBe('^(BashTool)$');
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
});
