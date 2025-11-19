import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../ConnectionManager';
import type { OpenHandsSettings } from '../../settings/SettingsManager';

// Stub WebSocket connect() to avoid network
(ConnectionManager as any).prototype['connect'] = function() {};

const dummyEvents = {
  onStatus: () => {},
  onEvent: () => {},
  onError: () => {},
};

describe('ConnectionManager startNewConversation payload', () => {
  const baseUrl = 'http://example.com';
  const cm = new ConnectionManager(baseUrl, dummyEvents as any);

  const settings: OpenHandsSettings = {
    serverUrl: baseUrl,
    llm: {
      usageId: 'use-1',
      model: 'anthropic/claude-3-5',
      baseUrl: 'https://api.example.com',
      apiVersion: '2024-10-01',
      timeout: 30,
      temperature: 0.2,
      topP: 0.9,
      topK: 50,
      maxInputTokens: 10000,
      maxOutputTokens: 2048,
      reasoningEffort: 'medium',
    },
    agent: { enableSecurityAnalyzer: true },
    conversation: { maxIterations: 77 },
    confirmation: { policy: 'risky', riskyThreshold: 'MEDIUM', confirmUnknown: false },
    secrets: { sessionApiKey: 'sess', llmApiKey: 'k', awsAccessKeyId: 'AK', awsSecretAccessKey: 'SK' },
  };

  let fetchSpy: any;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis as any, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ conversation_id: 'abc' }) });
    cm.setSettings(settings);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends expected StartConversationRequest fields', async () => {
    await cm.startNewConversation();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/conversations\/?$/);
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Session-API-Key']).toBe('sess');

    const body = JSON.parse(opts.body);
    // workspace
    expect(body.workspace).toEqual({ kind: 'LocalWorkspace', working_dir: process.cwd() });
    // confirmation
    expect(body.confirmation_policy).toEqual({ kind: 'ConfirmRisky', threshold: 'MEDIUM', confirm_unknown: false });
    // max iterations clamped in 1..500
    expect(body.max_iterations).toBe(77);
    // security analyzer
    expect(body.agent.security_analyzer).toEqual({ kind: 'LLMSecurityAnalyzer' });
    // tools present (names only check)
    const toolNames = body.agent.tools.map((t: any) => t.name);
    expect(toolNames).toContain('terminal');
    expect(toolNames).toContain('file_editor');
    expect(toolNames).toContain('task_tracker');
    body.agent.tools.forEach((tool: any) => {
      expect(tool.params).toBeUndefined();
    });
    // llm mapping
    expect(body.agent.llm.usage_id).toBe('use-1');
    expect(body.agent.llm.model).toBe('anthropic/claude-3-5');
    expect(body.agent.llm.base_url).toBe('https://api.example.com');
    expect(body.agent.llm.api_version).toBe('2024-10-01');
    expect(body.agent.llm.api_key).toBe('k');
    expect(body.agent.llm.aws_access_key_id).toBe('AK');
    expect(body.agent.llm.aws_secret_access_key).toBe('SK');
    expect(body.agent.llm.timeout).toBe(30);
    expect(body.agent.llm.temperature).toBe(0.2);
    expect(body.agent.llm.top_p).toBe(0.9);
    expect(body.agent.llm.top_k).toBe(50);
    expect(body.agent.llm.max_input_tokens).toBe(10000);
    expect(body.agent.llm.max_output_tokens).toBe(2048);
    expect(body.agent.llm.reasoning_effort).toBe('medium');
    // regression: ensure filter_tools_regex is not sent
    expect(body.agent.filter_tools_regex).toBeUndefined();
  });

  it('clamps max_iterations to [1,500]', async () => {
    const baseUrl = 'http://example.com';
    const cm = new ConnectionManager(baseUrl, dummyEvents as any);
    const s: OpenHandsSettings = {
      serverUrl: baseUrl,
      llm: {}, agent: { enableSecurityAnalyzer: false },
      conversation: { maxIterations: 9999 },
      confirmation: { policy: 'never', riskyThreshold: 'HIGH', confirmUnknown: true },
      secrets: {}
    } as any;
    cm.setSettings(s);
    let body: any;
    const spy = vi.spyOn(globalThis as any, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ conversation_id: 'zzz' }) } as any;
    });
    await cm.startNewConversation();
    expect(body.max_iterations).toBe(500);
    spy.mockRestore();
  });

  it('omits max token fields when values are <= 0', async () => {
    const cmZero = new ConnectionManager(baseUrl, dummyEvents as any);
    const zeroSettings: OpenHandsSettings = {
      ...settings,
      llm: {
        ...settings.llm,
        maxInputTokens: 0,
        maxOutputTokens: -1
      }
    };
    cmZero.setSettings(zeroSettings);

    let body: any;
    const spy = vi.spyOn(globalThis as any, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ conversation_id: 'omit' }) } as any;
    });

    await cmZero.startNewConversation();
    expect(body.agent.llm.max_input_tokens).toBeUndefined();
    expect(body.agent.llm.max_output_tokens).toBeUndefined();

    spy.mockRestore();
  });
});

describe('ConnectionManager omits explicit llm fields when unset', () => {
  it('omits llm.usage_id and llm.model when not configured to allow server defaults', async () => {
    const baseUrl = 'http://example.com';
    const cm2 = new ConnectionManager(baseUrl, dummyEvents as any);
    const s2: OpenHandsSettings = {
      serverUrl: baseUrl,
      llm: {
        // intentionally undefined
      },
      agent: { enableSecurityAnalyzer: false },
      conversation: { maxIterations: 50 },
      confirmation: { policy: 'never', riskyThreshold: 'HIGH', confirmUnknown: true },
      secrets: {}
    } as any;
    cm2.setSettings(s2);
    let called = false;
    const spy = vi.spyOn(globalThis as any, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      called = true;
      const body = JSON.parse(opts.body);
      expect(body.agent.llm.usage_id).toBeUndefined();
      expect(body.agent.llm.model).toBeUndefined();
      return { ok: true, json: async () => ({ conversation_id: 'def' }) } as any;
    });
    await cm2.startNewConversation();
    expect(called).toBe(true);
    spy.mockRestore();
  });
});
