import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted storage for mock instances (must be created via vi.hoisted)
const hoisted = vi.hoisted(() => ({ instances: [] as any[] }));

// Mock the 'ws' module before importing the module under test
vi.mock('ws', () => {
  function ctor(this: any, url: string) {
    const listeners: Record<string, Function[]> = {};
    const inst: any = {
      url,
      readyState: 0, // CONNECTING
      on: vi.fn((evt: string, cb: Function) => {
        (listeners[evt] ||= []).push(cb);
      }),
      removeAllListeners: vi.fn(() => {
        for (const k of Object.keys(listeners)) delete listeners[k];
      }),
      close: vi.fn(() => {
        // simulate immediate close event
        (listeners['close'] || []).forEach((cb) => cb());
      }),
      _emit: (evt: string, ...args: any[]) => {
        if (evt === 'open') inst.readyState = 1; // OPEN
        if (evt === 'close') inst.readyState = 3; // CLOSED
        (listeners[evt] || []).forEach((cb) => cb(...args));
      },
      _listeners: listeners,
    };
    hoisted.instances.push(inst);
    return inst;
  }
  const WebSocketMock: any = vi.fn(ctor);
  // expose readyState constants used by code under test
  WebSocketMock.OPEN = 1;
  WebSocketMock.CONNECTING = 0;
  WebSocketMock.CLOSING = 2;
  WebSocketMock.CLOSED = 3;
  // also expose instances for tests
  WebSocketMock.__instances = hoisted.instances;
  return { default: WebSocketMock };
});

import WebSocket from 'ws';
import { BashEventsClient, type BashEventsCallbacks } from '../BashEventsClient';
import type { BashCommand, BashExit, BashOutput } from '../../types/agent-sdk';

const makeClient = (overrides: Partial<BashEventsCallbacks> = {}, serverUrl = 'http://localhost:3000', apiKey?: string) => {
  const onEvent = vi.fn();
  const onError = vi.fn();
  const onStatus = vi.fn();
  const callbacks: BashEventsCallbacks = { onEvent, onError, onStatus, ...overrides } as BashEventsCallbacks;
  const client = new BashEventsClient(serverUrl, callbacks, apiKey);
  return { client, onEvent, onError, onStatus };
};

const nextWs = (idx: number) => (WebSocket as any).__instances[idx];

describe('BashEventsClient - lifecycle and behavior', () => {
  beforeEach(() => {
    // reset mocks and fake timers for deterministic backoff
    vi.clearAllMocks();
    const WS: any = WebSocket as any;
    if (Array.isArray(WS.__instances)) WS.__instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connect() establishes WebSocket to /sockets/bash-events and includes api key', () => {
    const { client, onStatus } = makeClient({}, 'http://localhost:3000', 'test-api-key');
    client.connect();

    const WS = WebSocket as unknown as vi.Mock;
    expect(WS.mock.calls.length).toBe(1);
    const urlArg = WS.mock.calls[0][0];
    expect(urlArg).toContain('ws://localhost:3000/sockets/bash-events');
    expect(urlArg).toContain('session_api_key=test-api-key');

    expect(onStatus).toHaveBeenCalledWith('connecting');

    // simulate successful connection
    nextWs(0)._emit('open');
    expect(onStatus).toHaveBeenCalledWith('online');
  });

  it('setServerUrl and setSessionApiKey affect subsequent connections', () => {
    const { client } = makeClient();
    client.setServerUrl('http://example.org:4000/');
    client.setSessionApiKey('abc123');
    client.connect();

    const WS = WebSocket as unknown as vi.Mock;
    const urlArg = WS.mock.calls[0][0];
    expect(urlArg).toBe('ws://example.org:4000/sockets/bash-events?session_api_key=abc123');
  });

  it('connect() is a no-op if already connecting or open', () => {
    const { client } = makeClient();
    client.connect();
    // second connect while connecting should not create another socket
    client.connect();

    const WS = WebSocket as unknown as vi.Mock;
    expect(WS.mock.calls.length).toBe(1);

    // simulate open
    nextWs(0)._emit('open');
    // try connecting again while open
    client.connect();
    expect(WS.mock.calls.length).toBe(1);
  });

  it('disconnect() closes WebSocket, removes listeners, and sets offline', () => {
    const { client, onStatus } = makeClient();
    client.connect();
    const ws0 = nextWs(0);
    ws0._emit('open');

    client.disconnect();

    expect(ws0.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(ws0.close).toHaveBeenCalledTimes(1);
    // since listeners are removed, close should not schedule reconnect
    const WS = WebSocket as unknown as vi.Mock;
    expect(WS.mock.calls.length).toBe(1);
    expect(onStatus).toHaveBeenLastCalledWith('offline');
  });

  it('disconnect() clears any pending reconnect timer', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { client } = makeClient();
    client.connect();
    const ws0 = nextWs(0);
    ws0._emit('open');

    // simulate unexpected close -> schedules reconnect after 1000ms
    ws0._emit('close');

    // immediately disconnect -> should clear the scheduled timer
    client.disconnect();

    const WS = WebSocket as unknown as vi.Mock;
    vi.advanceTimersByTime(1000);
    expect(WS.mock.calls.length).toBe(1); // no new connection created
  });

  it('reconnect() disconnects existing socket and opens a new one', () => {
    const { client } = makeClient();
    client.connect();
    const ws0 = nextWs(0);
    ws0._emit('open');

    client.reconnect();

    const WS = WebSocket as unknown as vi.Mock;
    expect(ws0.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(ws0.close).toHaveBeenCalledTimes(1);
    expect(WS.mock.calls.length).toBe(2);
  });

  it('reconnect() resets retry count (backoff returns to 1s)', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { client } = makeClient();
    client.connect();

    // First close -> schedule after 1s
    nextWs(0)._emit('close');
    const WS = WebSocket as unknown as vi.Mock;
    vi.advanceTimersByTime(1000);
    expect(WS.mock.calls.length).toBe(2);

    // Second close -> schedule after 2s
    nextWs(1)._emit('close');
    vi.advanceTimersByTime(2000);
    expect(WS.mock.calls.length).toBe(3);

    // Now call reconnect() -> should reset internal counter
    client.reconnect();

    // Close again -> schedule after 1s (not 4s)
    nextWs(3)._emit('close');
    vi.advanceTimersByTime(999);
    expect(WS.mock.calls.length).toBe(4);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(5);
  });

  it('parses and emits BashCommand events', () => {
    const { client, onEvent } = makeClient();
    client.connect();

    const evt: BashCommand = {
      type: 'BashCommand',
      id: 'e1',
      timestamp: new Date().toISOString(),
      command_id: 'c1',
      order: 0,
      command: 'ls -la',
    };

    nextWs(0)._emit('message', JSON.stringify(evt));
    expect(onEvent).toHaveBeenCalledWith(evt);
  });

  it('parses and emits BashOutput events', () => {
    const { client, onEvent } = makeClient();
    client.connect();

    const evt: BashOutput = {
      type: 'BashOutput',
      id: 'e2',
      timestamp: new Date().toISOString(),
      command_id: 'c1',
      order: 1,
      exit_code: null,
      stdout: 'file1\n',
      stderr: null,
    };

    nextWs(0)._emit('message', JSON.stringify(evt));
    expect(onEvent).toHaveBeenCalledWith(evt);
  });

  it('parses and emits BashExit events', () => {
    const { client, onEvent } = makeClient();
    client.connect();

    const evt: BashExit = {
      type: 'BashExit',
      id: 'e3',
      timestamp: new Date().toISOString(),
      command_id: 'c1',
      order: 2,
      exit_code: 0,
    };

    nextWs(0)._emit('message', JSON.stringify(evt));
    expect(onEvent).toHaveBeenCalledWith(evt);
  });

  it('ignores invalid event objects without calling onError', () => {
    const { client, onEvent, onError } = makeClient();
    client.connect();

    nextWs(0)._emit('message', JSON.stringify({ foo: 'bar' }));
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores malformed JSON without calling onError', () => {
    const { client, onEvent, onError } = makeClient();
    client.connect();

    // send a value that cannot be parsed as JSON
    nextWs(0)._emit('message', '{not-json');
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError on WebSocket error event and does not change status', () => {
    const { client, onError } = makeClient();
    client.connect();

    const err = new Error('boom');
    nextWs(0)._emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);

    // status remains as connecting until open/close
    expect(client.getStatus()).toBe('connecting');
  });

  it('maintains offline/connecting state across error events', () => {
    const { client, onStatus } = makeClient();
    client.connect();
    const ws0 = nextWs(0);

    // error while connecting should not flip to offline
    ws0._emit('error', new Error('connect error'));
    expect(client.getStatus()).toBe('connecting');

    // once closed -> becomes offline
    ws0._emit('close');
    expect(onStatus).toHaveBeenLastCalledWith('offline');

    // error after offline should keep offline
    ws0._emit('error', new Error('post-close error'));
    expect(client.getStatus()).toBe('offline');
  });

  it('attempts reconnection on close with exponential backoff capped at 15s', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { client } = makeClient();
    client.connect();

    const WS = WebSocket as unknown as vi.Mock;

    // 1st close -> +1s
    nextWs(0)._emit('close');
    vi.advanceTimersByTime(999);
    expect(WS.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(2);

    // 2nd close -> +2s
    nextWs(1)._emit('close');
    vi.advanceTimersByTime(1999);
    expect(WS.mock.calls.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(3);

    // 3rd close -> +4s
    nextWs(2)._emit('close');
    vi.advanceTimersByTime(3999);
    expect(WS.mock.calls.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(4);

    // 4th close -> +8s
    nextWs(3)._emit('close');
    vi.advanceTimersByTime(7999);
    expect(WS.mock.calls.length).toBe(4);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(5);

    // 5th close -> backoff wants 16s but capped to 15s
    nextWs(4)._emit('close');
    vi.advanceTimersByTime(14999);
    expect(WS.mock.calls.length).toBe(5);
    vi.advanceTimersByTime(1);
    expect(WS.mock.calls.length).toBe(6);
  });

  it('status callback sequence reflects state transitions', () => {
    const { client, onStatus } = makeClient();
    client.connect();
    const ws0 = nextWs(0);

    expect(onStatus).toHaveBeenCalledWith('connecting');
    ws0._emit('open');
    expect(onStatus).toHaveBeenCalledWith('online');
    ws0._emit('close');
    expect(onStatus).toHaveBeenCalledWith('offline');

    // calling disconnect again while already offline should not call onStatus
    onStatus.mockReset();
    client.disconnect();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('injectEvent() delivers event without WebSocket connection and validates type', () => {
    const { client, onEvent } = makeClient();
    const evt: BashCommand = {
      type: 'BashCommand',
      id: 'inj-1',
      timestamp: new Date().toISOString(),
      command_id: 'cmd-1',
      order: 0,
      command: 'echo hi',
    };

    client.injectEvent(evt);
    expect(onEvent).toHaveBeenCalledWith(evt);

    expect(() => client.injectEvent({ type: 'Nope' } as any)).toThrow();
  });

  it('setSessionApiKey() updates the query param for new connections', () => {
    const { client } = makeClient();
    client.setSessionApiKey('first');
    client.connect();

    let WS = WebSocket as unknown as vi.Mock;
    expect(WS.mock.calls[0][0]).toContain('session_api_key=first');

    client.disconnect();
    client.setSessionApiKey('second');
    client.connect();

    expect(WS.mock.calls[1][0]).toContain('session_api_key=second');
  });
});
