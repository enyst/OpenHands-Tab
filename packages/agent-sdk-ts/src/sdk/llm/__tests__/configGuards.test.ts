import { describe, expect, it } from 'vitest';
import type { LLMConfiguration } from '../types';
import { normalizeGenerationParamsForModel } from '../configGuards';

const makeConfig = (overrides: Partial<LLMConfiguration> = {}): LLMConfiguration => ({
  model: 'gpt-4o',
  ...overrides,
});

describe('normalizeGenerationParamsForModel', () => {
  it('preserves generation parameters for non-gpt-5 models', () => {
    const config = normalizeGenerationParamsForModel(makeConfig({ temperature: 0.5 }));
    expect(config.temperature).toBe(0.5);
  });

  it('drops temperature for gpt-5 models', () => {
    const config = normalizeGenerationParamsForModel(makeConfig({ model: 'gpt-5.1', temperature: 0.2 }));
    expect(config.temperature).toBeNull();
  });
});
