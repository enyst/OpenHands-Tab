import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '../types';

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

describe('RemoteConversation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    wsInstances = [];
    (globalThis as any).fetch = undefined as any;
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
});
