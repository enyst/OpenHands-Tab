import { describe, expect, it } from 'vitest';
import { AuthHttpClient, AuthHttpNetworkError, AuthHttpStatusError, type HttpFetchLike, type HttpResponseLike } from '../httpClient';

function jsonResponse(status: number, json: unknown): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

describe('AuthHttpClient', () => {
  it('joins endpoints under a base path and strips trailing slashes', async () => {
    const calls: Array<{ url: string; init: { method: string; headers?: Record<string, string>; body?: string } }> = [];
    const fetch: HttpFetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { ok: true });
    };

    const client = new AuthHttpClient({ baseUrl: 'https://example.com/v1/', fetch });
    const out = await client.requestJson({
      method: 'POST',
      endpoint: '/oauth/device/token',
      json: { hello: 'world' },
      raiseForStatus: false,
    });

    await client.requestJson({
      method: 'POST',
      endpoint: 'oauth/device/token',
      json: { hello: 'world' },
      raiseForStatus: false,
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://example.com/v1/oauth/device/token');
    expect(calls[0]?.init.headers?.['content-type']).toBe('application/json');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ hello: 'world' }));
    expect(calls[1]?.url).toBe('https://example.com/v1/oauth/device/token');
  });

  it('supports form_data bodies', async () => {
    const fetch: HttpFetchLike = async (_url, init) => {
      expect(init.headers?.['content-type']).toBe('application/x-www-form-urlencoded');
      expect(init.body).toContain('a=1');
      expect(init.body).toContain('b=two');
      return jsonResponse(200, { ok: true });
    };

    const client = new AuthHttpClient({ baseUrl: 'https://example.com', fetch });
    await client.requestJson({
      method: 'POST',
      endpoint: 'oauth/form',
      formData: { a: '1', b: 'two' },
    });
  });

  it('extracts JSON error details and throws AuthHttpStatusError by default', async () => {
    const fetch: HttpFetchLike = async () => jsonResponse(401, { detail: 'Unauthorized' });
    const client = new AuthHttpClient({ baseUrl: 'https://example.com/api', fetch });

    try {
      await client.requestJson({ method: 'GET', endpoint: 'me' });
      throw new Error('Expected AuthHttpStatusError');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthHttpStatusError);
      expect(err).toMatchObject({ status: 401, detail: 'Unauthorized' });
      expect(err instanceof Error ? err.message : String(err)).toBe('HTTP 401: Unauthorized');
    }
  });

  it('falls back to status code string when JSON lacks detail', async () => {
    const fetch: HttpFetchLike = async () => jsonResponse(400, { error: 'bad_request' });
    const client = new AuthHttpClient({ baseUrl: 'https://example.com/api', fetch });

    try {
      await client.requestJson({ method: 'GET', endpoint: 'me' });
      throw new Error('Expected AuthHttpStatusError');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthHttpStatusError);
      expect(err).toMatchObject({ status: 400, detail: '400' });
      expect(err instanceof Error ? err.message : String(err)).toBe('HTTP 400: 400');
    }
  });

  it('does not throw on non-2xx when raiseForStatus=false', async () => {
    const fetch: HttpFetchLike = async () => jsonResponse(400, { detail: 'nope' });
    const client = new AuthHttpClient({ baseUrl: 'https://example.com/api', fetch });
    const out = await client.requestJson({ method: 'GET', endpoint: 'me', raiseForStatus: false });
    expect(out).toEqual({ ok: false, status: 400, data: { detail: 'nope' } });
  });

  it('maps network failures to AuthHttpNetworkError', async () => {
    const fetch: HttpFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = new AuthHttpClient({ baseUrl: 'https://example.com/api', fetch });
    await expect(client.requestJson({ method: 'GET', endpoint: 'me' })).rejects.toBeInstanceOf(AuthHttpNetworkError);
  });
});
