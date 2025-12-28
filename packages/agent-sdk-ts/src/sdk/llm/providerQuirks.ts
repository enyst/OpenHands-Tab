import type { LLMConfiguration } from './types';

const isGpt5Model = (model: string | undefined): boolean => {
  if (typeof model !== 'string') return false;
  const normalized = model.trim().toLowerCase();
  return normalized.includes('gpt-5');
};

const hasExtendedThinking = (config: LLMConfiguration): boolean => {
  return config.reasoningEffort !== null && config.reasoningEffort !== undefined && config.reasoningEffort !== 'none';
};

/**
 * Detect if a model is an Anthropic Claude model.
 * This includes direct API access and LiteLLM proxy routing (anthropic/model-name).
 */
export const isAnthropicModel = (config: LLMConfiguration): boolean => {
  // Check provider first
  if (config.provider === 'anthropic') return true;

  // Check model name patterns
  const model = config.model?.trim().toLowerCase() ?? '';

  // LiteLLM routing prefix (e.g., anthropic/claude-3-opus)
  if (model.startsWith('anthropic/')) return true;

  // Claude model names (claude-3, claude-opus, claude-sonnet, etc.)
  if (model.includes('claude')) return true;

  // Check baseUrl for Anthropic endpoints
  const baseUrl = config.baseUrl?.toLowerCase() ?? '';
  if (baseUrl.includes('anthropic.com')) return true;

  return false;
};

/**
 * Check if the model supports extended thinking with thinking blocks.
 * Currently only Anthropic Claude models support this format.
 */
export const supportsThinkingBlocks = (config: LLMConfiguration): boolean => {
  return isAnthropicModel(config) && hasExtendedThinking(config);
};

/**
 * Normalize generation parameters based on provider-specific requirements.
 * 
 * Provider quirks handled:
 * - GPT-5 models: temperature must be stripped entirely
 * - Anthropic with extended thinking: temperature must be exactly 1
 *   See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations
 */
export const normalizeGenerationParamsForModel = (config: LLMConfiguration): LLMConfiguration => {
  // GPT-5 models: strip temperature entirely
  if (isGpt5Model(config.model)) {
    return { ...config, temperature: null };
  }

  // Anthropic models with extended thinking: temperature must be exactly 1
  // This applies to ALL Anthropic models when thinking is enabled, not just specific ones
  if (isAnthropicModel(config) && hasExtendedThinking(config)) {
    return { ...config, temperature: 1 };
  }

  return config;
};
