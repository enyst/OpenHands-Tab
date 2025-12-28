import { describe, expect, it } from 'vitest';
import type { LLMConfiguration } from '../types';
import { normalizeGenerationParamsForModel, isAnthropicModel, supportsThinkingBlocks } from '../providerQuirks';

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

  // Anthropic requires temperature=1 when extended thinking is enabled
  // See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations
  it('forces temperature to 1 for any Anthropic model with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-3-5-sonnet', temperature: 0, reasoningEffort: 'high' })
    );
    expect(config.temperature).toBe(1);
  });

  it('forces temperature to 1 for claude-haiku with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-haiku-4-5-20241022', temperature: 0.5, reasoningEffort: 'low' })
    );
    expect(config.temperature).toBe(1);
  });

  it('forces temperature to 1 for LiteLLM anthropic routing with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'anthropic/claude-haiku-4-5', temperature: 0.5, reasoningEffort: 'medium' })
    );
    expect(config.temperature).toBe(1);
  });

  it('forces temperature to 1 for anthropic provider with extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ provider: 'anthropic', model: 'claude-3-opus', temperature: 0, reasoningEffort: 'high' })
    );
    expect(config.temperature).toBe(1);
  });

  it('preserves temperature for Anthropic model without extended thinking', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ provider: 'anthropic', model: 'claude-4-5-opus', temperature: 0.7 })
    );
    expect(config.temperature).toBe(0.7);
  });

  it('preserves temperature for Anthropic model with reasoningEffort=none', () => {
    const config = normalizeGenerationParamsForModel(
      makeConfig({ model: 'claude-opus-4-5', temperature: 0.5, reasoningEffort: 'none' })
    );
    expect(config.temperature).toBe(0.5);
  });
});

describe('isAnthropicModel', () => {
  it('returns true for anthropic provider', () => {
    expect(isAnthropicModel(makeConfig({ provider: 'anthropic' }))).toBe(true);
  });

  it('returns true for claude model names', () => {
    expect(isAnthropicModel(makeConfig({ model: 'claude-3-opus' }))).toBe(true);
    expect(isAnthropicModel(makeConfig({ model: 'claude-opus-4-5-20251101' }))).toBe(true);
    expect(isAnthropicModel(makeConfig({ model: 'claude-3-5-sonnet' }))).toBe(true);
  });

  it('returns true for LiteLLM anthropic routing prefix', () => {
    expect(isAnthropicModel(makeConfig({ model: 'anthropic/claude-3-opus' }))).toBe(true);
  });

  it('returns true for anthropic.com baseUrl', () => {
    expect(isAnthropicModel(makeConfig({ baseUrl: 'https://api.anthropic.com/v1' }))).toBe(true);
  });

  it('returns false for OpenAI models', () => {
    expect(isAnthropicModel(makeConfig({ model: 'gpt-4o', provider: 'openai' }))).toBe(false);
    expect(isAnthropicModel(makeConfig({ model: 'gpt-5-mini' }))).toBe(false);
  });

  it('returns false for Gemini models', () => {
    expect(isAnthropicModel(makeConfig({ model: 'gemini-2.5-flash', provider: 'gemini' }))).toBe(false);
  });

  it('returns false for LiteLLM proxy without anthropic model', () => {
    expect(isAnthropicModel(makeConfig({
      model: 'gpt-4o',
      provider: 'litellm_proxy',
      baseUrl: 'http://localhost:4000',
    }))).toBe(false);
  });
});

describe('supportsThinkingBlocks', () => {
  it('returns true for Anthropic model with extended thinking', () => {
    expect(supportsThinkingBlocks(makeConfig({
      model: 'claude-opus-4-5',
      reasoningEffort: 'high',
    }))).toBe(true);
  });

  it('returns false for Anthropic model without extended thinking', () => {
    expect(supportsThinkingBlocks(makeConfig({
      model: 'claude-3-opus',
    }))).toBe(false);
  });

  it('returns false for Anthropic model with reasoningEffort=none', () => {
    expect(supportsThinkingBlocks(makeConfig({
      model: 'claude-opus-4-5',
      reasoningEffort: 'none',
    }))).toBe(false);
  });

  it('returns false for non-Anthropic model even with extended thinking', () => {
    expect(supportsThinkingBlocks(makeConfig({
      model: 'gpt-4o',
      provider: 'openai',
      reasoningEffort: 'high',
    }))).toBe(false);
  });
});
