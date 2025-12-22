import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { DiskLruCache } from '../diskLruCache';
import { ElevenLabsTtsService } from '../ttsService';

describe('DiskLruCache', () => {
  it('prunes oldest entries when exceeding maxBytes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-elevenlabs-cache-'));
    try {
      const cache = new DiskLruCache(dir, 30);
      await cache.set('a', new Uint8Array(20));
      await cache.set('b', new Uint8Array(20));

      const a = await cache.get('a');
      const b = await cache.get('b');
      expect(a).toBeUndefined();
      expect(b?.byteLength).toBe(20);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ElevenLabsTtsService', () => {
  it('caches by voiceId/modelId/text', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-elevenlabs-service-'));
    try {
      const service = new ElevenLabsTtsService({ cacheDir: dir, maxCacheBytes: 1024 * 1024 });
      const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 9, 9]), { status: 200 }));

      const first = await service.synthesize({
        apiKey: 'xi-test',
        voiceId: 'voice-123',
        modelId: 'eleven_turbo_v2',
        text: 'Hello',
        cacheEnabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const second = await service.synthesize({
        apiKey: 'xi-test',
        voiceId: 'voice-123',
        modelId: 'eleven_turbo_v2',
        text: 'Hello',
        cacheEnabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(second.bytes).toEqual(new Uint8Array([9, 9, 9]));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not write when cache is disabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-elevenlabs-nocache-'));
    try {
      const service = new ElevenLabsTtsService({ cacheDir: dir, maxCacheBytes: 1024 * 1024 });
      const fetchImpl = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1]), { status: 200 }));

      await service.synthesize({
        apiKey: 'xi-test',
        voiceId: 'voice-123',
        text: 'Hello',
        cacheEnabled: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await service.synthesize({
        apiKey: 'xi-test',
        voiceId: 'voice-123',
        text: 'Hello',
        cacheEnabled: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
