import { describe, expect, it } from 'vitest';
import { clearRawLlmFieldsWhenProfileSelected } from '../types/settings';

describe('clearRawLlmFieldsWhenProfileSelected', () => {
  it('leaves raw llm fields intact when profileId is not set', () => {
    const input = {
      profileId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'http://example.test',
      openaiApiMode: 'chat_completions',
      maxInputTokens: 123,
      usageId: 'u1',
    } as any;

    expect(clearRawLlmFieldsWhenProfileSelected(input)).toEqual(input);
  });

  it('clears raw llm fields when profileId is set', () => {
    const input = {
      profileId: 'p1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'http://example.test',
      openaiApiMode: 'chat_completions',
      apiVersion: '2025-01-01',
      timeout: 10,
      temperature: 0.5,
      topP: 1,
      topK: 5,
      maxInputTokens: 123,
      maxOutputTokens: 456,
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
      inputCostPerToken: 0.1,
      outputCostPerToken: 0.2,
      usageId: 'u1',
    } as any;

    expect(clearRawLlmFieldsWhenProfileSelected(input)).toEqual({
      ...input,
      provider: undefined,
      model: undefined,
      openaiApiMode: undefined,
      baseUrl: undefined,
      apiVersion: undefined,
      timeout: undefined,
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      maxInputTokens: undefined,
      maxOutputTokens: undefined,
      reasoningEffort: undefined,
      reasoningSummary: undefined,
      inputCostPerToken: undefined,
      outputCostPerToken: undefined,
    });
  });
});

