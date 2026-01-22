import { describe, expect, it, vi } from 'vitest';
import { bootstrapCloudRemoteConversation } from '../cloud/cloudRemoteBootstrap';

describe('bootstrapCloudRemoteConversation', () => {
  it('uses Bearer-only SaaS auth and returns nested runtime connection info', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { status: 'WORKING' },
          { status: 'READY', app_conversation_id: 'ac-123' },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            conversation_url: 'https://runtime.example.com/api/conversations/conv-456',
            session_api_key: 'runtime-key-xyz',
          },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const result = await bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://app.all-hands.dev/api/v1/app-conversations/stream-start');
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer cloud-key-abc',
      }),
    }));
    expect((fetchSpy.mock.calls[0]?.[1] as any)?.headers?.['X-Session-API-Key']).toBeUndefined();

    expect(fetchSpy.mock.calls[1]?.[0]).toContain('/api/v1/app-conversations?ids=');
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer cloud-key-abc',
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      saasServerUrl: 'https://app.all-hands.dev',
      appConversationId: 'ac-123',
      conversationUrl: 'https://runtime.example.com/api/conversations/conv-456',
      nestedServerUrl: 'https://runtime.example.com',
      conversationId: 'conv-456',
      runtimeSessionApiKey: 'runtime-key-xyz',
    }));
  });

  it('errors clearly when V1 endpoints are missing (404)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/does not support V1/i);
  });

  it('errors on authentication failure (401)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'invalid-key',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/invalid or expired Cloud API Key/i);
  });

  it('errors on authentication failure (403)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'expired-key',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/invalid or expired Cloud API Key/i);
  });

  it('errors when stream-start returns non-array JSON', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ not: 'an array' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/expected JSON array/i);
  });

  it('errors when stream-start response has no READY task', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { status: 'WORKING' },
        { status: 'PENDING' },
      ]),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/never reached READY/i);
  });

  it('errors with detail when stream-start response has ERROR task', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { status: 'WORKING' },
        { status: 'ERROR', detail: 'Sandbox provisioning failed' },
      ]),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/Sandbox provisioning failed/i);
  });

  it('errors when GET app-conversations returns missing conversation_url', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { status: 'READY', app_conversation_id: 'ac-123' },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { session_api_key: 'runtime-key-xyz' }, // missing conversation_url
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/missing conversation_url/i);
  });

  it('errors when GET app-conversations returns missing session_api_key', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { status: 'READY', app_conversation_id: 'ac-123' },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { conversation_url: 'https://runtime.example.com/api/conversations/conv-456' }, // missing session_api_key
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/missing session_api_key/i);
  });

  it('errors when conversation_url has unexpected format', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { status: 'READY', app_conversation_id: 'ac-123' },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            conversation_url: 'https://runtime.example.com/invalid/path', // missing /api/conversations/<id>
            session_api_key: 'runtime-key-xyz',
          },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/could not parse conversation_url/i);
  });

  it('errors when GET app-conversations returns 401', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { status: 'READY', app_conversation_id: 'ac-123' },
        ]),
        text: () => Promise.resolve(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Token expired'),
      } as unknown as Response);

    await expect(bootstrapCloudRemoteConversation({
      saasServerUrl: 'https://app.all-hands.dev',
      cloudApiKey: 'cloud-key-abc',
      fetchFn: fetchSpy as unknown as typeof fetch,
      timeoutMs: 10_000,
    })).rejects.toThrow(/invalid or expired Cloud API Key/i);
  });
});

