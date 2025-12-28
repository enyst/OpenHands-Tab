import type { LLMConfiguration } from './types';

const isGpt5Model = (model: string | undefined): boolean => {
  if (typeof model !== 'string') return false;
  const normalized = model.trim().toLowerCase();
  return normalized.includes('gpt-5');
};

const isOpus45Model = (model: string | undefined): boolean => {
  if (typeof model !== 'string') return false;
  const normalized = model.trim().toLowerCase();
  // Match opus-4-5, opus-4.5, claude-opus-4-5, claude-opus-4.5, etc.
  return normalized.includes('opus-4-5') || normalized.includes('opus-4.5');
};

const hasExtendedThinking = (config: LLMConfiguration): boolean => {
  return config.reasoningEffort != null && config.reasoningEffort !== 'none';
};

export const normalizeGenerationParamsForModel = (config: LLMConfiguration): LLMConfiguration => {
  // GPT-5 models: strip temperature entirely
  if (isGpt5Model(config.model)) {
    return { ...config, temperature: null };
  }

  // Opus 4.5 with extended thinking: temperature must be exactly 1
  if (isOpus45Model(config.model) && hasExtendedThinking(config)) {
    return { ...config, temperature: 1 };
  }

  return config;
};
