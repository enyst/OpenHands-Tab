import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Event } from '../types';
import { saveProfile } from '../llm';

let wsInstances: MockWS[] = [];

type Handler = (...args: unknown[]) => void;

class MockWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  handlers: Record<string, Handler[]> = {};
  readyState = MockWS.CONNECTING;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
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

  it('includes non-LLM secrets when starting a new conversation', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      expect(url).toContain('/api/conversations');
      const body = JSON.parse(init?.body ?? '{}');
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
          elevenLabsApiKey: 'xi-example123',
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

  it('derives usage_id from profileId when usageId is default-llm', async () => {
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
          llm: { profileId: 'p1', usageId: 'default-llm' },
        } as any,
        profileStoreOptions: { rootDir: dir },
      });

      const id = await conversation.startNewConversation();
      conversation.disconnect();

      expect(id).toBe('conv-1');
      expect(capturedReq?.agent?.llm?.usage_id).toBe('p1');
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
          elevenLabsApiKey: 'xi-example123',
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
