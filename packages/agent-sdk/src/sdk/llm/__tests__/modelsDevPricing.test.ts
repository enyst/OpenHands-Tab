import { describe, expect, it } from 'vitest';
import { extractModelsDevTokenPricing, getModelsDevProviderId } from '../modelsDevPricing';

describe('modelsDevPricing', () => {
  describe('getModelsDevProviderId', () => {
    it('maps known providers to models.dev ids', () => {
      expect(getModelsDevProviderId('openai')).toBe('openai');
      expect(getModelsDevProviderId('anthropic')).toBe('anthropic');
      expect(getModelsDevProviderId('gemini')).toBe('google');
      expect(getModelsDevProviderId('openrouter')).toBe('openrouter');
    });

    it('returns null for providers without stable mapping', () => {
      expect(getModelsDevProviderId('litellm_proxy')).toBeNull();
    });
  });

  describe('extractModelsDevTokenPricing', () => {
    it('converts USD per 1M tokens into per-token rates', () => {
      const api = {
        openai: {
          models: {
            'gpt-5': { cost: { input: 1.25, output: 10, cache_read: 0.5, cache_write: 2 } },
          },
        },
      };
      const pricing = extractModelsDevTokenPricing({
        api,
        providerId: 'openai',
        modelId: 'gpt-5',
      });
      expect(pricing).toEqual({
        inputCostPerToken: 1.25 / 1_000_000,
        cacheReadCostPerToken: 0.5 / 1_000_000,
        cacheWriteCostPerToken: 2 / 1_000_000,
        outputCostPerToken: 10 / 1_000_000,
        source: 'models.dev',
      });
    });

    it('is case-insensitive on model ids', () => {
      const api = {
        openai: {
          models: {
            'gpt-5': { cost: { input: 1.25, output: 10, cache_read: 0.5 } },
          },
        },
      };
      const pricing = extractModelsDevTokenPricing({
        api,
        providerId: 'openai',
        modelId: 'GPT-5',
      });
      expect(pricing?.inputCostPerToken).toBeCloseTo(1.25 / 1_000_000);
      expect(pricing?.cacheReadCostPerToken).toBeCloseTo(0.5 / 1_000_000);
      expect(pricing?.outputCostPerToken).toBeCloseTo(10 / 1_000_000);
    });

    it('returns null when costs are missing or zero', () => {
      const api = {
        openai: {
          models: {
            a: { cost: { input: 0, output: 10 } },
            b: { cost: { input: 1, output: 0 } },
            c: { cost: { input: null, output: 10 } },
            d: {},
          },
        },
      };

      expect(extractModelsDevTokenPricing({ api, providerId: 'openai', modelId: 'a' })).toBeNull();
      expect(extractModelsDevTokenPricing({ api, providerId: 'openai', modelId: 'b' })).toBeNull();
      expect(extractModelsDevTokenPricing({ api, providerId: 'openai', modelId: 'c' })).toBeNull();
      expect(extractModelsDevTokenPricing({ api, providerId: 'openai', modelId: 'd' })).toBeNull();
      expect(extractModelsDevTokenPricing({ api, providerId: 'openai', modelId: 'missing' })).toBeNull();
    });
  });
});
