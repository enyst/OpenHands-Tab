import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Event } from '../types';
import { saveProfile } from '../llm';
import { ConfirmRisky } from '../security/confirmationPolicy';
import { LLMSecurityAnalyzer } from '../security/analyzer';

let wsInstances: MockWS[] = [];

type Handler = (...args: unknown[]) => void;

class MockWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  options?: any;
  handlers: Record<string, Handler[]> = {};
  readyState = MockWS.CONNECTING;
  sent: string[] = [];

  constructor(url: string, options?: any) {
    this.url = url;
    this.options = options;
    wsInstances.push(this);
  }

  on(ev: string, cb: Handler) {
    this.handlers[ev] = this.handlers[ev] || [];
    this.handlers[ev].push(cb);
    return this as any;
  }

  emit(ev: string, ...args: unknown[]) {
    (this.handlers[ev] || []).forEach((fn) => fn(...args));
  }

  open() {
    this.readyState = MockWS.OPEN;
    this.emit('open');
  }

  message(data: any) {
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    this.emit('message', payload);
  }

  error(err: any) {
    this.emit('error', err);
  }

  close() {
    this.readyState = MockWS.CLOSED;
    this.emit('close');
  }

  removeAllListeners() {
    this.handlers = {};
  }

  send(data: string) {
    this.sent.push(data);
  }
}

vi.mock('ws', () => ({ default: MockWS }));

const getEventWS = () => wsInstances.find((ws) => ws.url.includes('/sockets/events')) ?? wsInstances[0];
const getEventWSHeaders = () => (getEventWS()?.options?.headers ?? {}) as Record<string, unknown>;

const baseSettings = {
  llm: { model: 'test-model' },
  agent: { enableSecurityAnalyzer: false },
  conversation: { maxIterations: 2 },
  confirmation: { policy: 'never' as const },
  secrets: {},
};

const makeTempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('RemoteConversation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    wsInstances = [];
    (globalThis as any).fetch = undefined as any;
  });

  it('times out if the WebSocket never connects', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (url: string) => {
        expect(url).toContain('/events/search');
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      });
      (globalThis as any).fetch = fetchMock;

      const { RemoteConversation } = await import('../conversation/RemoteConversation');
      const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

      const statuses: string[] = [];
      const errors: unknown[] = [];
      conversation.on('status', (s) => statuses.push(s));
      conversation.on('error', (e) => errors.push(e));

      await conversation.restoreConversation('abc');
      expect(conversation.getStatus()).toBe('connecting');

      vi.advanceTimersByTime(10_001);

      expect(conversation.getStatus()).toBe('offline');
      expect(statuses).toContain('connecting');
      expect(statuses).toContain('offline');
      expect(errors.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets offline when starting a new conversation fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    const statuses: string[] = [];
    conversation.on('status', (s) => statuses.push(s));
    conversation.on('error', () => {});

    const id = await conversation.startNewConversation();
    expect(id).toBeUndefined();
    expect(conversation.getStatus()).toBe('offline');
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('offline');
  });

  it('sendUserMessage includes extended_content in the HTTP payload when WS is not open', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/api/conversations/abc/events')) {
        expect(init?.method).toBe('POST');
        const payload = JSON.parse(String(init?.body ?? 'null'));
        expect(payload).toMatchObject({
          role: 'user',
          content: [{ type: 'text', text: 'hello' }],
          run: true,
          extended_content: [{ type: 'text', text: 'note: user edited file' }],
        });
        return { ok: true, status: 200, text: async () => '' } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await conversation.sendUserMessage('hello', {
      extendedContent: [{ type: 'text', text: 'note: user edited file' }],
    });
  });

  it('sendUserMessage includes extended_content in the WS payload when WS is open', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    const ws = getEventWS();
    ws.open();

    await conversation.sendUserMessage('hello', {
      extendedContent: [{ type: 'text', text: 'note: user edited file' }],
    });

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0] ?? '')).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      extended_content: [{ type: 'text', text: 'note: user edited file' }],
    });
  });

  it('includes non-LLM secrets when starting a new conversation', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      expect(url).toContain('/api/conversations');
      const body = JSON.parse(init?.body ?? '{}');
      expect(body.agent.kind).toBe('Agent');
      expect(body.workspace).toEqual({ working_dir: process.cwd() });
      expect(body.secrets).toEqual({
        ELEVENLABS_API_KEY: { kind: 'StaticSecret', value: 'xi-example123' },
        GITHUB_TOKEN: { kind: 'StaticSecret', value: 'ghp_example123' },
        CUSTOM_SECRET_1: { kind: 'StaticSecret', value: 'secret-1' },
        CUSTOM_SECRET_2: { kind: 'StaticSecret', value: 'secret-2' },
        CUSTOM_SECRET_3: { kind: 'StaticSecret', value: 'secret-3' },
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'conv-1' }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: {
        ...baseSettings,
        secrets: {
          halTtsApiKey: 'xi-example123',
          githubToken: 'ghp_example123',
          customSecret1: 'secret-1',
          customSecret2: 'secret-2',
          customSecret3: 'secret-3',
        },
      } as any,
    });

    const id = await conversation.startNewConversation();
    conversation.disconnect();
    expect(id).toBe('conv-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'enabled', enableSecurityAnalyzer: true },
    { label: 'disabled', enableSecurityAnalyzer: false },
  ])('handles security_analyzer payload when $label', async ({ enableSecurityAnalyzer }) => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      expect(url).toContain('/api/conversations');
      const body = JSON.parse(init?.body ?? '{}');
      expect(body.agent.kind).toBe('Agent');
      if (enableSecurityAnalyzer) {
        expect(body.agent.security_analyzer).toEqual({ kind: 'LLMSecurityAnalyzer' });
      } else {
        expect('security_analyzer' in body.agent).toBe(false);
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'conv-1' }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: {
        ...baseSettings,
        agent: { ...baseSettings.agent, enableSecurityAnalyzer },
      },
    });

    const id = await conversation.startNewConversation();
    conversation.disconnect();
    expect(id).toBe('conv-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('always uses a stable usage_id of agent', async () => {
    const dir = makeTempDir('remote-conversation-profiles-');
    try {
      saveProfile('p1', { provider: 'openai', model: 'gpt-5-mini' }, { rootDir: dir });

      let capturedReq: any = null;
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        expect(url).toContain('/api/conversations');
        capturedReq = JSON.parse(init?.body ?? '{}');
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'conv-1' }),
          text: async () => '',
        } as any;
      });
      (globalThis as any).fetch = fetchMock;

      const { RemoteConversation } = await import('../conversation/RemoteConversation');
      const conversation = new RemoteConversation({
        serverUrl: 'http://localhost:3000',
        settings: {
          ...baseSettings,
          llm: { profileId: 'p1' },
        } as any,
        profileStoreOptions: { rootDir: dir },
      });

      const id = await conversation.startNewConversation();
      conversation.disconnect();

      expect(id).toBe('conv-1');
      expect(capturedReq?.agent?.kind).toBe('Agent');
      expect(capturedReq?.agent?.llm?.usage_id).toBe('agent');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers profile config over settings llm overrides when profileId is set', async () => {
    const dir = makeTempDir('remote-conversation-profile-precedence-');
    try {
      saveProfile('p1', {
        provider: 'openai',
        model: 'profile-model',
        baseUrl: 'https://profile.example',
        apiVersion: '2025-01-01',
        timeoutSeconds: 111,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxInputTokens: 1234,
        maxOutputTokens: 2345,
        reasoningEffort: 'high',
      }, { rootDir: dir });

      let capturedReq: any = null;
      const fetchMock = vi.fn(async (url: string, init?: any) => {
        expect(url).toContain('/api/conversations');
        capturedReq = JSON.parse(init?.body ?? '{}');
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'conv-1' }),
          text: async () => '',
        } as any;
      });
      (globalThis as any).fetch = fetchMock;

      const { RemoteConversation } = await import('../conversation/RemoteConversation');
      const conversation = new RemoteConversation({
        serverUrl: 'http://localhost:3000',
        settings: {
          ...baseSettings,
          llm: {
            profileId: 'p1',
            model: 'settings-model',
            baseUrl: 'https://settings.example',
            apiVersion: '2025-12-31',
            timeout: 999,
            temperature: 0.1,
            topP: 0.1,
            topK: 1,
            maxInputTokens: 1,
            maxOutputTokens: 2,
            reasoningEffort: 'low',
          },
        } as any,
        profileStoreOptions: { rootDir: dir },
      });

      const id = await conversation.startNewConversation();
      conversation.disconnect();

      expect(id).toBe('conv-1');
      expect(capturedReq?.agent?.kind).toBe('Agent');
      const llm = capturedReq?.agent?.llm ?? {};
      expect(llm.usage_id).toBe('agent');
      expect(llm.model).toBe('profile-model');
      expect(llm.base_url).toBe('https://profile.example');
      expect(llm.api_version).toBe('2025-01-01');
      expect(llm.timeout).toBe(111);
      expect(llm.temperature).toBe(0.7);
      expect(llm.top_p).toBe(0.8);
      expect(llm.top_k).toBe(40);
      expect(llm.max_input_tokens).toBe(1234);
      expect(llm.max_output_tokens).toBe(2345);
      expect(llm.reasoning_effort).toBe('high');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits invalid secret values when starting a new conversation', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      expect(url).toContain('/api/conversations');
      const body = JSON.parse(init?.body ?? '{}');
      expect(body.secrets).toEqual({
        ELEVENLABS_API_KEY: { kind: 'StaticSecret', value: 'xi-example123' },
      });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'conv-1' }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: {
        ...baseSettings,
        secrets: {
          halTtsApiKey: 'xi-example123',
          githubToken: 123 as any,
          customSecret1: {} as any,
          customSecret2: '   ' as any,
          customSecret3: null as any,
        },
      } as any,
    });

    const id = await conversation.startNewConversation();
    conversation.disconnect();
    expect(id).toBe('conv-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replays history on restore and skips duplicate event ids', async () => {
    const history: Event[] = [
      {
        id: 'e-1',
        kind: 'MessageEvent',
        source: 'user',
        llm_message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      } as Event,
      {
        id: 'e-2',
        kind: 'ActionEvent',
        source: 'agent',
        thought: [{ type: 'text', text: 'thinking' }],
        action: { command: 'pwd' },
        tool_name: 'terminal',
        tool_call_id: 'tc-1',
        tool_call: { id: 'tc-1', type: 'function', function: { name: 'terminal', arguments: '{}' } },
        llm_response_id: 'r-1',
      } as Event,
    ];

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/events/search');
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: history, next_page_id: null }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    const received: Event[] = [];
    const started = vi.fn();
    conversation.on('event', (e) => received.push(e));
    conversation.on('conversationStarted', started);

    await conversation.restoreConversation('abc');

    expect(started).toHaveBeenCalledWith('abc');
    expect(received.map((e) => e.id)).toEqual(['e-1', 'e-2']);

    const ws = getEventWS();
    ws.open();
    ws.message({ ...history[0] });
    ws.message({ ...history[1], id: 'e-3' });

    expect(received.map((e) => e.id)).toEqual(['e-1', 'e-2', 'e-3']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maintains RemoteState from ConversationStateUpdateEvent history + stream', async () => {
    const history: Event[] = [
      {
        id: 's-1',
        kind: 'ConversationStateUpdateEvent',
        source: 'environment',
        key: 'full_state',
        value: {
          execution_status: 'running',
          confirmation_policy: { kind: 'NeverConfirm' },
          stats: { llm: { total_cost: 0 } },
        },
      } as Event,
    ];

    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/events/search');
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: history, next_page_id: null }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    expect(conversation.state.executionStatus).toBe('running');
    expect(conversation.state.confirmationPolicy).toEqual({ kind: 'NeverConfirm' });

    const ws = getEventWS();
    ws.open();
    ws.message({
      id: 's-2',
      kind: 'ConversationStateUpdateEvent',
      source: 'environment',
      key: 'execution_status',
      value: 'paused',
    });

    expect(conversation.state.executionStatus).toBe('paused');
  });

  it('askAgent posts /ask_agent and returns response without emitting events', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/ask_agent')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body).toEqual({ question: 'What is 2+2?' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: '4' }),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    const received: Event[] = [];
    conversation.on('event', (e) => received.push(e));

    await conversation.restoreConversation('abc');
    received.length = 0;

    await expect(conversation.askAgent('What is 2+2?')).resolves.toBe('4');
    expect(received).toEqual([]);
  });

  it('askAgent throws when server returns null JSON', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/ask_agent')) {
        return {
          ok: true,
          status: 200,
          json: async () => null,
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.askAgent('What is 2+2?')).rejects.toThrow('askAgent: server response missing "response"');
  });

  it('askAgent throws when server response is missing "response"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/ask_agent')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.askAgent('What is 2+2?')).rejects.toThrow('askAgent: server response missing "response"');
  });

  it('askAgent throws on non-2xx response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/ask_agent')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ response: 'ignored' }),
          text: async () => 'unavailable',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.askAgent('What is 2+2?')).rejects.toThrow('Failed to ask agent (HTTP 503): unavailable');
  });

  it('generateTitle posts /generate_title and returns the title', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/generate_title')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body.max_length).toBe(12);
        expect(body.llm).toEqual({
          usage_id: 'agent',
          model: 'custom-model',
          base_url: 'https://llm.example',
          api_version: '2025-01-01',
          api_key: 'llm-key',
          timeout: 10,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ title: 'My title' }),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.generateTitle({
      maxLength: 12,
      llm: {
        model: 'custom-model',
        apiKeyRef: { kind: 'inline', value: 'llm-key' },
        baseUrl: 'https://llm.example',
        apiVersion: '2025-01-01',
        timeoutSeconds: 10,
      },
    })).resolves.toBe('My title');
  });

  it('generateTitle throws when server returns null JSON', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/generate_title')) {
        return {
          ok: true,
          status: 200,
          json: async () => null,
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.generateTitle()).rejects.toThrow('generateTitle: server response missing "title"');
  });

  it('generateTitle throws when server response is missing "title"', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/generate_title')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.generateTitle()).rejects.toThrow('generateTitle: server response missing "title"');
  });

  it('generateTitle throws when server response has a non-string title', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/generate_title')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ title: 123 }),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.generateTitle()).rejects.toThrow('generateTitle: server response missing "title"');
  });

  it('condense posts /condense', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/condense')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeUndefined();
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.condense()).resolves.toBeUndefined();
  });

  it('condense throws on non-2xx response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/condense')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => 'no condenser configured',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.condense()).rejects.toThrow('Failed to condense conversation (HTTP 400): no condenser configured');
  });

  it('updateSecrets posts /secrets', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/secrets')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body).toEqual({ secrets: { GITHUB_TOKEN: 'ghp_abc123' } });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.updateSecrets({ GITHUB_TOKEN: 'ghp_abc123' })).resolves.toBeUndefined();
  });

  it('updateSecrets throws when no active conversation', async () => {
    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await expect(conversation.updateSecrets({ GITHUB_TOKEN: 'ghp_abc123' })).rejects.toThrow(
      'Cannot updateSecrets: no active conversation. Start or restore a conversation first.',
    );
  });

  it('updateSecrets throws on non-2xx response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/secrets')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => 'forbidden',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    await expect(conversation.updateSecrets({ GITHUB_TOKEN: 'ghp_abc123' })).rejects.toThrow('Failed to update secrets (HTTP 403): forbidden');
  });

  it('setConfirmationPolicy posts /confirmation_policy', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/confirmation_policy')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers?.['X-Session-API-Key']).toBe('session-key');
        const body = JSON.parse(init?.body ?? '{}');
        expect(body).toEqual({
          policy: { kind: 'ConfirmRisky', threshold: 'HIGH', confirm_unknown: false },
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: { ...baseSettings, secrets: { runtimeSessionApiKey: 'session-key' } },
    });

    await conversation.restoreConversation('abc');

    await expect(conversation.setConfirmationPolicy(new ConfirmRisky({ threshold: 'HIGH', confirmUnknown: false }))).resolves.toBeUndefined();
    conversation.disconnect();
  });

  it('setConfirmationPolicy throws when no active conversation', async () => {
    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await expect(conversation.setConfirmationPolicy({ kind: 'NeverConfirm' })).rejects.toThrow(
      'Cannot setConfirmationPolicy: no active conversation. Start or restore a conversation first.',
    );
  });

  it('setSecurityAnalyzer posts /security_analyzer and supports null', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/events/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      }

      if (url.includes('/security_analyzer')) {
        call += 1;
        expect(init?.method).toBe('POST');
        expect(init?.headers?.['X-Session-API-Key']).toBe('session-key');
        const body = JSON.parse(init?.body ?? '{}');
        if (call === 1) {
          expect(body).toEqual({ security_analyzer: { kind: 'LLMSecurityAnalyzer' } });
        } else {
          expect(body).toEqual({ security_analyzer: null });
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: { ...baseSettings, secrets: { runtimeSessionApiKey: 'session-key' } },
    });

    await conversation.restoreConversation('abc');

    await expect(conversation.setSecurityAnalyzer(new LLMSecurityAnalyzer())).resolves.toBeUndefined();
    await expect(conversation.setSecurityAnalyzer(null)).resolves.toBeUndefined();
    conversation.disconnect();
  });

  it('setSecurityAnalyzer throws when no active conversation', async () => {
    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    await expect(conversation.setSecurityAnalyzer(null)).rejects.toThrow(
      'Cannot setSecurityAnalyzer: no active conversation. Start or restore a conversation first.',
    );
  });

  it('getWorkspace exposes a RemoteWorkspace using runtimeSessionApiKey and invalidates on key change', async () => {
    let uploadCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.includes('/api/file/upload')) {
        expect(init?.method).toBe('POST');
        uploadCalls += 1;
        expect(init?.headers?.['X-Session-API-Key']).toBe(uploadCalls === 1 ? 'session-key-1' : 'session-key-2');
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as any;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      workspaceRoot: '/workspace',
      settings: { ...baseSettings, secrets: { runtimeSessionApiKey: 'session-key-1' } },
    });

    const w1 = conversation.getWorkspace();
    const w2 = conversation.getWorkspace();
    expect(w1).toBe(w2);
    expect(w1.kind).toBe('remote');
    expect(w1.root).toBe('/workspace');

    await w1.writeFile('notes.txt', 'hello');

    conversation.setSettings({ ...baseSettings, secrets: { runtimeSessionApiKey: 'session-key-2' } });
    const w3 = conversation.getWorkspace();
    expect(w3).not.toBe(w1);

    await w3.writeFile('notes.txt', 'hello');
  });

  it('normalizes serverUrl without protocol for HTTP and WebSocket', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toMatch(/^http:\/\/localhost:3000\//);
      expect(url).toContain('/events/search');
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], next_page_id: null }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'localhost:3000', settings: baseSettings });

    await conversation.restoreConversation('abc');

    const ws = getEventWS();
    expect(ws.url).toMatch(/^ws:\/\/localhost:3000\/sockets\/events\/abc\?/);
    expect(ws.url).toContain('resend_all=true');
  });

  it('does not include session_api_key in WebSocket URL query params', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/events/search');
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], next_page_id: null }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: {
        ...baseSettings,
        secrets: { ...baseSettings.secrets, runtimeSessionApiKey: 'session-key' },
      },
    });

    await conversation.restoreConversation('abc');

    const ws = getEventWS();
    expect(ws.url).toContain('resend_all=true');
    expect(ws.url).not.toContain('session_api_key=');
    expect(ws.url).not.toContain('session-key');

    const headers = getEventWSHeaders();
    expect(headers['X-Session-API-Key']).toBe('session-key');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('does not retry WebSocket with session_api_key query auth after a 403 handshake response', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/events/search');
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], next_page_id: null }),
        text: async () => '',
      } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({
      serverUrl: 'http://localhost:3000',
      settings: {
        ...baseSettings,
        secrets: { ...baseSettings.secrets, runtimeSessionApiKey: 'session-key' },
      },
    });

    const errors: unknown[] = [];
    conversation.on('error', (error) => errors.push(error));

    await conversation.restoreConversation('abc');

    const ws = getEventWS();
    ws.error(new Error('Unexpected server response: 403'));

    const eventSockets = wsInstances.filter((socket) => socket.url.includes('/sockets/events'));
    expect(eventSockets).toHaveLength(1);
    expect(eventSockets[0]?.url).not.toContain('session_api_key=');
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('403');
  });

  it('does not attempt WebSocket connect when history fetch fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    (globalThis as any).fetch = fetchMock;

    const { RemoteConversation } = await import('../conversation/RemoteConversation');
    const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

    const statuses: string[] = [];
    const errors: unknown[] = [];
    conversation.on('status', (s) => statuses.push(s));
    conversation.on('error', (e) => errors.push(e));

    await conversation.restoreConversation('abc');

    expect(conversation.getStatus()).toBe('offline');
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('offline');
    expect(errors).toHaveLength(1);
    expect(wsInstances).toHaveLength(0);
  });

  it('caps reconnect attempts after disconnect and requires manual reconnect', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const fetchMock = vi.fn(async (url: string) => {
        expect(url).toContain('/events/search');
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], next_page_id: null }),
          text: async () => '',
        } as any;
      });
      (globalThis as any).fetch = fetchMock;

      const { RemoteConversation } = await import('../conversation/RemoteConversation');
      const conversation = new RemoteConversation({ serverUrl: 'http://localhost:3000', settings: baseSettings });

      const errors: unknown[] = [];
      conversation.on('error', (e) => errors.push(e));

      await conversation.restoreConversation('abc');
      const ws0 = getEventWS();
      ws0.open();
      ws0.close();

      const reconnectDelays = [1000, 2000, 4000, 8000, 15000, 15000];
      for (const delay of reconnectDelays) {
        vi.advanceTimersByTime(delay);
        const ws = wsInstances[wsInstances.length - 1];
        ws.error(new Error('boom'));
      }

      const eventSockets = () => wsInstances.filter((ws) => ws.url.includes('/sockets/events'));
      expect(eventSockets()).toHaveLength(1 + reconnectDelays.length);

      vi.advanceTimersByTime(60_000);
      expect(eventSockets()).toHaveLength(1 + reconnectDelays.length);

      const errorMessages = errors.map((e) => (e instanceof Error ? e.message : String(e)));
      expect(errorMessages.some((m) => m.includes('Reconnect retries exhausted'))).toBe(true);

      conversation.reconnect();
      expect(eventSockets()).toHaveLength(1 + reconnectDelays.length + 1);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
