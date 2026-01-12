import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { LlmClientCache } from '../LlmClientCache';

class MockClient implements LLMClient {
  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    yield { type: 'finish' };
  }
}

describe('LlmClientCache', () => {
  it('returns injected client without creating a new one', async () => {
    const injected = new MockClient();
    const createClient = vi.fn(async () => new MockClient());
    const createStreamer = vi.fn(() => ({ kind: 'streamer' }));

    const cache = new LlmClientCache({
      getInjectedClient: () => injected,
      createClient,
      createStreamer,
    });

    await expect(cache.getPrimaryClient()).resolves.toBe(injected);
    await expect(cache.getStreamer()).resolves.toEqual({ kind: 'streamer' });
    expect(createClient).not.toHaveBeenCalled();
    expect(createStreamer).toHaveBeenCalledTimes(1);
  });

  it('caches client creation across calls', async () => {
    const createClient = vi.fn(async () => new MockClient());
    const createStreamer = vi.fn(() => ({ kind: 'streamer' }));

    const cache = new LlmClientCache({
      createClient,
      createStreamer,
    });

    const [a, b] = await Promise.all([cache.getPrimaryClient(), cache.getPrimaryClient()]);
    expect(a).toBe(b);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('caches streamer creation and resets on clear()', async () => {
    const createClient = vi.fn(async () => new MockClient());
    const createStreamer = vi.fn(() => ({ id: randomUUID() }));

    const cache = new LlmClientCache({
      createClient,
      createStreamer,
    });

    const first = await cache.getStreamer();
    const again = await cache.getStreamer();
    expect(first).toBe(again);
    expect(createStreamer).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);

    cache.clear();

    const second = await cache.getStreamer();
    expect(second).not.toBe(first);
    expect(createStreamer).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
