import { describe, expect, it } from 'vitest';
import type { OpenHandsSettings } from '../../types/settings';
import { buildLlmRequestParametersForDebug } from '../debug';

describe('buildLlmRequestParametersForDebug', () => {
  it('strips temperature for GPT-5 model variants', () => {
    const llmSettings: OpenHandsSettings['llm'] = { temperature: 0.3 };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'openai/gpt-5-codex',
    });

    expect(parameters?.temperature).toBeUndefined();
  });

  it('truncates encrypted_reasoning for readability', () => {
    const llmSettings: OpenHandsSettings['llm'] = { encrypted_reasoning: 'abcdefghijklmnop' };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'gpt-4o',
    });

    expect(parameters?.encrypted_reasoning).toBe('abcd..mnop');
  });

  it('keeps short encrypted_reasoning values intact', () => {
    const llmSettings: OpenHandsSettings['llm'] = { encrypted_reasoning: 'abc123' };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'gpt-4o',
    });

    expect(parameters?.encrypted_reasoning).toBe('abc123');
  });

  it('keeps exactly eight characters unchanged', () => {
    const llmSettings: OpenHandsSettings['llm'] = { encrypted_reasoning: '12345678' };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'gpt-4o',
    });

    expect(parameters?.encrypted_reasoning).toBe('12345678');
  });

  it('omits encrypted_reasoning when empty or whitespace', () => {
    const llmSettings: OpenHandsSettings['llm'] = { encrypted_reasoning: '   ' };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'gpt-4o',
    });

    expect(parameters).toBeUndefined();
  });

  it('omits encrypted_reasoning when nullish', () => {
    const llmSettings: OpenHandsSettings['llm'] = { encrypted_reasoning: null };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'gpt-4o',
    });

    expect(parameters).toBeUndefined();
  });

  it('retains temperature for non GPT-5 models', () => {
    const llmSettings: OpenHandsSettings['llm'] = { temperature: 0.6 };

    const parameters = buildLlmRequestParametersForDebug({
      llmSettings,
      model: 'claude-3-opus-20240229',
    });

    expect(parameters?.temperature).toBe(0.6);
  });
});
