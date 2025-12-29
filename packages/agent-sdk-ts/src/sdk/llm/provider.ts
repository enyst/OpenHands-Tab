import type { LLMProvider } from './types';

export const DEFAULT_PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  litellm_proxy: 'http://localhost:4000',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

export const detectProviderFromBaseUrl = (baseUrl?: string | null): LLMProvider => {
  const normalized = (baseUrl ?? '').toLowerCase();
  if (normalized.includes('anthropic.com')) return 'anthropic';
  if (normalized.includes('openrouter.ai')) return 'openrouter';
  if (normalized.includes('litellm') || normalized.includes('llm-proxy')) return 'litellm_proxy';
  if (normalized.includes('generativelanguage.googleapis.com') || normalized.includes('ai.google.dev')) return 'gemini';
  return 'openai';
};
