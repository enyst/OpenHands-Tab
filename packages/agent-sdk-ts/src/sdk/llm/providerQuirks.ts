import type { LLMConfiguration } from './types';

/**
 * Provider Quirks
 * 
 * This module centralizes provider-specific API requirements and constraints.
 * Each provider has its own quirks that must be handled to avoid API errors.
 * 
 * References:
 * - Anthropic Messages API: https://platform.claude.com/docs/en/api/messages.md
 * - Anthropic Extended Thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 */

// =============================================================================
// Anthropic Extended Thinking Constraints
// =============================================================================
// 
// When extended thinking is enabled, Anthropic has several requirements:
// 
// 1. Temperature MUST be exactly 1
//    - Any other value returns 400 error
//    - See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#important-considerations
// 
// 2. budget_tokens constraints:
//    - Minimum: 1024 tokens
//    - Maximum: 128000 tokens (model dependent, but 128k is safe upper bound)
//    - Must be LESS than max_tokens (max_tokens > budget_tokens)
//    - See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
// 
// 3. Thinking signature is required when sending thinking blocks back
//    - The signature field from the response must be included
//    - See: toAnthropicMessages() in anthropic.ts
// =============================================================================

const ANTHROPIC_THINKING_MIN_BUDGET = 1024;
const ANTHROPIC_THINKING_MAX_BUDGET = 128000;

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
 * Get the thinking budget tokens for Anthropic extended thinking.
 * 
 * Returns undefined if thinking is not enabled.
 * Otherwise returns a value that satisfies Anthropic's constraints:
 * - At least 1024 tokens (minimum)
 * - At most 128000 tokens (maximum)
 * - 80% of maxOutputTokens (leaving 20% for actual output)
 */
export const getAnthropicThinkingBudget = (config: LLMConfiguration): number | undefined => {
  if (!isAnthropicModel(config) || !hasExtendedThinking(config)) {
    return undefined;
  }

  const maxTokens = config.maxOutputTokens ?? 16000;
  const budget = Math.floor(maxTokens * 0.8);

  return Math.min(ANTHROPIC_THINKING_MAX_BUDGET, Math.max(ANTHROPIC_THINKING_MIN_BUDGET, budget));
};

/**
 * Normalize generation parameters based on provider-specific requirements.
 * 
 * Provider quirks handled:
 * - GPT-5 models: temperature must be stripped entirely
 * - Anthropic with extended thinking: temperature must be exactly 1
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
