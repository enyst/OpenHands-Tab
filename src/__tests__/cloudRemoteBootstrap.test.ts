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

  it('errors clearly when V1 endpoints are missing', async () => {
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
});

