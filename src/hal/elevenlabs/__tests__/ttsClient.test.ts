import { describe, expect, it, vi } from 'vitest';
import { ElevenLabsError, fetchElevenLabsTts } from '../ttsClient';

describe('fetchElevenLabsTts', () => {
  it('retries on 5xx and succeeds', async () => {
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const bytes = await fetchElevenLabsTts({
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: 'Hello',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
      randomImpl: () => 0,
      maxRetries: 2,
    });

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenCalledWith(250);
  });

  it('does not retry on auth errors', async () => {
    const sleepImpl = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));

    await expect(
      fetchElevenLabsTts({
        apiKey: 'xi-test',
        voiceId: 'voice-123',
        text: 'Hello',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl,
        randomImpl: () => 0,
        maxRetries: 2,
      })
    ).rejects.toMatchObject({ name: 'ElevenLabsError', kind: 'auth', status: 401 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenCalledTimes(0);
  });

  it('fails fast when api key is missing', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchElevenLabsTts({
        apiKey: '',
        voiceId: 'voice-123',
        text: 'Hello',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toBeInstanceOf(ElevenLabsError);
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });
});

