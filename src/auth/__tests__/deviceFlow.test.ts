import { describe, expect, it } from 'vitest';
import {
  DeviceFlowHttpError,
  DeviceFlowNetworkError,
  DeviceFlowProtocolError,
  DeviceFlowTokenError,
  pollDeviceToken,
  startDeviceAuthorization,
  type HttpClientLike,
  type HttpResponseLike,
} from '../deviceFlow';

function jsonResponse(status: number, json: unknown): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function invalidJsonResponse(status: number, text: string): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('invalid json');
    },
    text: async () => text,
  };
}

function createSequenceHttp(steps: Array<(url: string, init: { body?: string; headers?: Record<string, string> }) => HttpResponseLike>): HttpClientLike {
  let i = 0;
  return async (url, init) => {
    const step = steps[i];
    if (!step) throw new Error(`Unexpected request #${i + 1}: ${url}`);
    i += 1;
    return step(url, init);
  };
}

describe('device flow client', () => {
  it('startDeviceAuthorization builds verificationUriComplete when absent', async () => {
    const http = createSequenceHttp([
      (url, init) => {
        expect(url).toBe('https://example.com/oauth/device/authorize');
        expect(init.headers?.['content-type']).toBe('application/json');
        expect(init.body).toBe('{}');
        return jsonResponse(200, {
          device_code: 'dev',
          user_code: 'ABC-123',
          verification_uri: 'https://example.com/verify?foo=bar',
          interval: 1,
        });
      },
    ]);

    const auth = await startDeviceAuthorization({ baseUrl: 'https://example.com', http });
    expect(auth.deviceCode).toBe('dev');
    expect(auth.userCode).toBe('ABC-123');
    expect(auth.intervalMs).toBe(1000);
    expect(auth.verificationUriComplete).toContain('https://example.com/verify');
    expect(new URL(auth.verificationUriComplete).searchParams.get('user_code')).toBe('ABC-123');
    expect(new URL(auth.verificationUriComplete).searchParams.get('foo')).toBe('bar');
  });

  it('pollDeviceToken retries on authorization_pending until success', async () => {
    let now = 0;
    const sleepCalls: number[] = [];
    const http = createSequenceHttp([
      (url, init) => {
        expect(url).toBe('https://example.com/oauth/device/token');
        expect(init.headers?.['content-type']).toBe('application/x-www-form-urlencoded');
        expect(init.body).toContain('device_code=dev');
        return jsonResponse(400, { error: 'authorization_pending' });
      },
      () => jsonResponse(200, { access_token: 'tok', token_type: 'bearer', expires_in: 123 }),
    ]);

    const out = await pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: {
        now: () => now,
        sleep: async (ms) => { sleepCalls.push(ms); now += ms; },
      },
    });
    expect(out).toEqual({ accessToken: 'tok', tokenType: 'bearer', expiresInSeconds: 123 });
    expect(sleepCalls).toEqual([1000]);
  });

  it('pollDeviceToken increases interval on slow_down', async () => {
    let now = 0;
    const sleepCalls: number[] = [];
    const http = createSequenceHttp([
      () => jsonResponse(400, { error: 'authorization_pending' }),
      () => jsonResponse(400, { error: 'slow_down' }),
      () => jsonResponse(400, { error: 'authorization_pending' }),
      () => jsonResponse(200, { access_token: 'tok' }),
    ]);

    const out = await pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 60_000,
      clock: {
        now: () => now,
        sleep: async (ms) => { sleepCalls.push(ms); now += ms; },
      },
    });
    expect(out.accessToken).toBe('tok');
    // first pending = 1000ms, slow_down doubles => 2000ms, then pending uses 2000ms
    expect(sleepCalls).toEqual([1000, 2000, 2000]);
  });

  it('pollDeviceToken fails on expired_token', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(400, { error: 'expired_token', error_description: 'expired' }),
    ]);

    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toMatchObject({ name: 'DeviceFlowTokenError', error: 'expired_token' });

    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http: createSequenceHttp([() => jsonResponse(400, { error: 'expired_token' })]),
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toThrow('Device code has expired');
  });

  it('pollDeviceToken fails on access_denied', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(400, { error: 'access_denied' }),
    ]);
    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toThrow('User denied the authorization request.');
  });

  it('pollDeviceToken surfaces unknown errors', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(400, { error: 'something_else', error_description: 'nope' }),
    ]);

    try {
      await pollDeviceToken({
        baseUrl: 'https://example.com',
        deviceCode: 'dev',
        pollIntervalMs: 1000,
        http,
        timeoutMs: 10_000,
        clock: { now: () => 0, sleep: async () => {} },
      });
      throw new Error('Expected pollDeviceToken to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(DeviceFlowTokenError);
      expect(err).toMatchObject({ error: 'something_else' });
      expect(err instanceof Error ? err.message : String(err)).toMatch(/Authorization error:/);
    }
  });

  it('pollDeviceToken throws on invalid JSON', async () => {
    const http = createSequenceHttp([
      () => invalidJsonResponse(500, 'Internal Server Error'),
    ]);
    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toThrow('Unexpected response from server: 500');
  });

  it('pollDeviceToken throws on non-2xx without error', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(500, { message: 'oops' }),
    ]);
    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toBeInstanceOf(DeviceFlowHttpError);
  });

  it('pollDeviceToken surfaces network errors', async () => {
    const http: HttpClientLike = async () => {
      throw new Error('network down');
    };
    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 10_000,
      clock: { now: () => 0, sleep: async () => {} },
    })).rejects.toBeInstanceOf(DeviceFlowNetworkError);
  });

  it('pollDeviceToken enforces timeout', async () => {
    let now = 0;
    let calls = 0;
    const http: HttpClientLike = async () => {
      calls += 1;
      return jsonResponse(400, { error: 'authorization_pending' });
    };

    await expect(pollDeviceToken({
      baseUrl: 'https://example.com',
      deviceCode: 'dev',
      pollIntervalMs: 1000,
      http,
      timeoutMs: 2500,
      clock: { now: () => now, sleep: async (ms) => { now += ms; } },
    })).rejects.toMatchObject({ name: 'DeviceFlowTimeoutError' });
    expect(calls).toBe(3);
  });

  it('startDeviceAuthorization throws on non-2xx', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(500, { message: 'nope' }),
    ]);
    await expect(startDeviceAuthorization({ baseUrl: 'https://example.com', http })).rejects.toBeInstanceOf(DeviceFlowHttpError);
  });

  it('startDeviceAuthorization throws on network error', async () => {
    const http: HttpClientLike = async () => {
      throw new Error('offline');
    };
    await expect(startDeviceAuthorization({ baseUrl: 'https://example.com', http })).rejects.toBeInstanceOf(DeviceFlowNetworkError);
  });

  it('startDeviceAuthorization throws on invalid JSON', async () => {
    const http = createSequenceHttp([
      () => invalidJsonResponse(200, 'not json'),
    ]);
    await expect(startDeviceAuthorization({ baseUrl: 'https://example.com', http })).rejects.toBeInstanceOf(DeviceFlowProtocolError);
  });

  it('startDeviceAuthorization throws when required fields are missing', async () => {
    const http = createSequenceHttp([
      () => jsonResponse(200, { device_code: 'dev' }),
    ]);
    await expect(startDeviceAuthorization({ baseUrl: 'https://example.com', http })).rejects.toBeInstanceOf(DeviceFlowProtocolError);
  });
});
