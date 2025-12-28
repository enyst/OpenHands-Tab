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

  it('drops temperature for models containing gpt-5 mid-string', () => {
    const config = normalizeGenerationParamsForModel(makeConfig({ model: 'openai/gpt-5-codex', temperature: 0.7 }));
    expect(config.temperature).toBeNull();
  });

  it('forces temperature to 1 for opus-4.5 with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-opus-4-5', temperature: 0, reasoningEffort: 'high' })
    );
    expect(config.temperature).toBe(1);
  });

  it('forces temperature to 1 for opus-4.5 variant with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'anthropic/opus-4.5', temperature: 0.5, reasoningEffort: 'medium' })
    );
    expect(config.temperature).toBe(1);
  });

  it('preserves temperature for opus-4.5 without extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-opus-4-5', temperature: 0.7 })
    );
    expect(config.temperature).toBe(0.7);
  });

  it('preserves temperature for opus-4.5 with reasoningEffort=none', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-opus-4-5', temperature: 0.5, reasoningEffort: 'none' })
    );
    expect(config.temperature).toBe(0.5);
  });
});
