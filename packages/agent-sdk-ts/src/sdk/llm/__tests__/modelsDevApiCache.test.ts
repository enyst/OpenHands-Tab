import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('getModelsDevApi', () => {
  it('retries after an initial fetch failure when no disk cache exists', async () => {
    const previousHome = process.env.HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'models-dev-home-'));
    process.env.HOME = tempHome;

    try {
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('network down');
        return {
          status: 200,
          ok: true,
          headers: {
            get: (key: string) => (key.toLowerCase() === 'etag' ? '"etag"' : null),
          },
          json: async () => ({
            openai: {
              models: {
                'gpt-5': { cost: { input: 1.25, output: 10 } },
              },
            },
          }),
        } as unknown;
      }));

      vi.resetModules();
      const { getModelsDevApi } = await import('../modelsDevPricing');

      const first = await getModelsDevApi();
      expect(Object.keys(first)).toHaveLength(0);

      const second = await getModelsDevApi();
      expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
      expect(Object.keys(second)).toContain('openai');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
      process.env.HOME = previousHome;
    }
  });
});

