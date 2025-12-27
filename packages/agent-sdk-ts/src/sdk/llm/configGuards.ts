import type { LLMConfiguration } from './types';

const isGpt5Model = (model: string | undefined): boolean => {
  if (typeof model !== 'string') return false;
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('gpt-5');
};

export const normalizeGenerationParamsForModel = (config: LLMConfiguration): LLMConfiguration => {
  if (!isGpt5Model(config.model)) return config;

  return { ...config, temperature: null };
};
