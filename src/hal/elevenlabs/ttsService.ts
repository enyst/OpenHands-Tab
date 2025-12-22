import * as crypto from 'crypto';
import { DiskLruCache } from './diskLruCache';
import { fetchElevenLabsTts, type ElevenLabsTtsParams } from './ttsClient';
import { normalizeTtsText } from './normalize';

export type ElevenLabsTtsServiceOptions = {
  cacheDir: string;
  maxCacheBytes: number;
};

export type ElevenLabsSynthesizeParams = Omit<ElevenLabsTtsParams, 'text'> & {
  text: string;
  cacheEnabled: boolean;
};

export class ElevenLabsTtsService {
  private readonly cache: DiskLruCache;

  constructor(options: ElevenLabsTtsServiceOptions) {
    this.cache = new DiskLruCache(options.cacheDir, options.maxCacheBytes);
  }

  async synthesize(params: ElevenLabsSynthesizeParams): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
    const text = normalizeTtsText(params.text);
    const modelId = params.modelId?.trim() || '';
    const cacheKeyRaw = `${params.voiceId}|${modelId}|${text}`;
    const cacheKey = crypto.createHash('sha256').update(cacheKeyRaw).digest('hex');

    if (params.cacheEnabled) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return { bytes: cached, fromCache: true };
    }

    const bytes = await fetchElevenLabsTts({ ...params, text });
    if (params.cacheEnabled) {
      await this.cache.set(cacheKey, bytes);
    }
    return { bytes, fromCache: false };
  }
}
