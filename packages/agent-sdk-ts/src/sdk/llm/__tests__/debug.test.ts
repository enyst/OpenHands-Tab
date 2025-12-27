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
});
