import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock 'ws' BEFORE importing the module under test
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

const importCM = async () => import('../ConnectionManager');

describe('ConnectionManager - Confirmation Mode', () => {
  let events: { onStatus: Mock; onEvent: Mock; onError: Mock; onConversationId: Mock };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    wsInstances = [];
    (globalThis as any).fetch = undefined as any;
  });
  afterEach(() => { vi.useRealTimers(); });

  const setupManager = async () => {
    const { ConnectionManager } = await importCM();
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const cm = new ConnectionManager('http://localhost:3000', events);
    // simulate restored conversation to avoid creating a new one in tests
    cm.restoreConversation('c-confirm');
    return cm;
  };

  it('approveAction posts accept=true to confirmation endpoint (HTTP)', async () => {
    const cm = await setupManager();
    const fetchSpy = vi.fn(async (url: string, init?: any) => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    await cm.approveAction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/conversations\/c-confirm\/events\/respond_to_confirmation$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ accept: true });
  });

  it('approveAction includes X-Session-API-Key header when configured', async () => {
    const cm = await setupManager();
    // set settings to include session key
    (cm as any).setSettings({ secrets: { sessionApiKey: 'sess-123' } } as any);
    const fetchSpy = vi.fn(async (url: string, init?: any) => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    await cm.approveAction();

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['X-Session-API-Key']).toBe('sess-123');
  });

  it('approveAction uses HTTP regardless of WebSocket availability (fallback behavior)', async () => {
    const cm = await setupManager();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    // If a WS exists and is open, approval should still be sent via HTTP endpoint
    const ws: any = (cm as any).ws || null;
    await cm.approveAction();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // ensure no .send was called on ws mock (if any)
    if (ws) expect(ws.sent.length).toBe(0);
  });


  it('rejectAction uses HTTP regardless of WebSocket availability (fallback behavior)', async () => {
    const cm = await setupManager();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    const ws: any = (cm as any).ws || null;
    await cm.rejectAction('nope');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    if (ws) expect(ws.sent.length).toBe(0);
  });

  it('rejectAction posts accept=false', async () => {
    const cm = await setupManager();
    const fetchSpy = vi.fn(async (url: string, init?: any) => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    await cm.rejectAction();

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.accept).toBe(false);
    // reason should be omitted when not provided
    expect('reason' in body).toBe(false);
  });

  it('rejectAction includes rejection reason when provided', async () => {
    const cm = await setupManager();
    const fetchSpy = vi.fn(async (url: string, init?: any) => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    await cm.rejectAction('Too risky');

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({ accept: false, reason: 'Too risky' });
  });

  it('rejectAction includes X-Session-API-Key header when configured', async () => {
    const cm = await setupManager();
    (cm as any).setSettings({ secrets: { sessionApiKey: 'sess-xyz' } } as any);
    const fetchSpy = vi.fn(async (url: string, init?: any) => ({ ok: true, status: 200 })) as any;
    (globalThis as any).fetch = fetchSpy;

    await cm.rejectAction('r');

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['X-Session-API-Key']).toBe('sess-xyz');
  });

  it('emits error when no active conversation (approve)', async () => {
    const { ConnectionManager } = await importCM();
    events = { onStatus: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onConversationId: vi.fn() };
    const cm = new ConnectionManager('http://localhost:3000', events);
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;

    await cm.approveAction();
    expect(events.onError).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handles network errors gracefully by emitting onError', async () => {
    const cm = await setupManager();
    const err = new Error('network down');
    (globalThis as any).fetch = vi.fn(async () => { throw err; });

    await cm.rejectAction('any');

    expect(events.onError).toHaveBeenCalledWith(err);
  });

  it('emits error event on HTTP failure status', async () => {
    const cm = await setupManager();
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any;

    await cm.approveAction();

    expect(events.onError).toHaveBeenCalled();
  });
});
