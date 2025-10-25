import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Install a mock for 'ws' BEFORE importing the module under test
let wsInstances: any[] = [];
vi.mock('ws', () => {
  class MockWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    handlers: Record<string, Function[]> = {};
    readyState = MockWS.CONNECTING;
    sent: string[] = [];
    closed = false;

    constructor(url: string) {
      this.url = url;
      wsInstances.push(this);
    }
    on(ev: string, cb: Function) {
      this.handlers[ev] = this.handlers[ev] || [];
      this.handlers[ev].push(cb);
      return this as any;
    }
    emit(ev: string, ...args: any[]) { (this.handlers[ev] || []).forEach(fn => fn(...args)); }
    open() { this.readyState = MockWS.OPEN; this.emit('open'); }
    message(data: any) { this.emit('message', Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))); }
    error(err: any) { this.emit('error', err); }
    close() { this.readyState = MockWS.CLOSED; this.closed = true; this.emit('close'); }
    send(data: string) { this.sent.push(data); }
  }
  return { default: MockWS };
});

// Helper to get last created WS
const getLastWS = () => wsInstances[wsInstances.length - 1];

// Mock fetch helper
const makeFetchOk = (json: any, status = 200) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => json })) as any;

// Lazily import after mocks are ready
const importCM = async () => {
  const mod = await import('../ConnectionManager');
  return mod;
};

describe('ConnectionManager', () => {
  let events: any;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    wsInstances = [];
    (globalThis as any).fetch = undefined as any;
    delete (process as any).env.SESSION_API_KEY;
  });

  afterEach(() => { vi.useRealTimers(); });

  it('startNewConversation succeeds, notifies, and connects WS', async () => {
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    const convoId = 'c-123';
    (globalThis as any).fetch = makeFetchOk({ id: convoId });

    const cm = new ConnectionManager('http://localhost:3000', events);
    const id = await cm.startNewConversation();

    expect(id).toBe(convoId);
    expect(events.onConversationId).toHaveBeenCalledWith(convoId);
    expect(events.onStatus).toHaveBeenCalledWith('connecting');

    const ws: any = getLastWS();
    expect(ws?.url).toMatch(/ws:\/\/localhost:3000\/sockets\/events\/c-123$/);

    ws.open();
    expect(events.onStatus).toHaveBeenLastCalledWith('online');
  });

  it('sendUserMessage uses WS when open; falls back to HTTP when closed', async () => {
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    const convoId = 'c-42';
    let postCalls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
      if (typeof init?.body === 'string') postCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: convoId }) } as any;
    });

    const cm = new ConnectionManager('http://localhost:3000', events);
    await cm.startNewConversation();

    const ws: any = getLastWS();
    ws.open();

    await cm.sendUserMessage('hello');
    expect(ws.sent.length).toBe(1);
    expect(ws.sent[0]).toContain('"role":"user"');
    expect(ws.sent[0]).toContain('hello');

    ws.close();
    await cm.sendUserMessage('offline send');
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    expect(postCalls[postCalls.length - 1].url).toMatch(/\/api\/conversations\/c-42\/events\//);
  });

  it('propagates incoming events via onEvent', async () => {
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    (globalThis as any).fetch = makeFetchOk({ id: 'c-1' });
    const cm = new ConnectionManager('http://localhost:3000', events);
    await cm.startNewConversation();
    const ws: any = getLastWS();
    ws.open();

    const payload = {
      type: 'MessageEvent',
      source: 'agent' as const,
      llm_message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] }
    };
    // Use JSON.stringify to test the actual JSON parsing path in ConnectionManager
    ws.message(JSON.stringify(payload));
    expect(events.onEvent).toHaveBeenCalledWith(payload as any);
  });

  it('reconnects after close (exponential backoff)', async () => {
    vi.useFakeTimers();
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    (globalThis as any).fetch = makeFetchOk({ id: 'c-xyz' });
    const cm = new ConnectionManager('http://localhost:3000', events);
    await cm.startNewConversation();

    let ws: any = getLastWS();
    ws.open();
    const countBefore = wsInstances.length;

    ws.close();
    expect(events.onStatus).toHaveBeenLastCalledWith('offline');

    // first retry after ~1000ms (+ up to ~200ms jitter)
    await vi.advanceTimersByTimeAsync(1200);

    const countAfter = wsInstances.length;
    expect(countAfter).toBeGreaterThan(countBefore);
    const ws2: any = getLastWS();
    expect(ws2.url).toContain('/sockets/events/c-xyz');
  });

  it('pause and resume call server endpoints', async () => {
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    const calls: any[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, init?: any) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) } as any; });
    const cm = new ConnectionManager('http://localhost:3000', events);
    await cm.restoreConversation('c-777');

    await cm.pause();
    await cm.resume();

    expect(calls.some(c => /\/pause$/.test(c.url))).toBe(true);
    expect(calls.some(c => /\/resume$/.test(c.url))).toBe(true);
  });

  it('restoreConversation sets id and connects', async () => {
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const { ConnectionManager } = await importCM();
    const cm = new ConnectionManager('http://localhost:3000', events);
    await cm.restoreConversation('c-rest');
    const ws: any = getLastWS();
    expect(ws.url).toContain('/sockets/events/c-rest');
    expect(events.onStatus).toHaveBeenCalledWith('connecting');
  });
});
