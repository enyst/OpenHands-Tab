import type { LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import type { SecretRegistry } from './SecretRegistry';

export interface GeminiClientOptions {
  usageId: string;
  profileId?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

const DEFAULT_GEMINI_PROFILE_ID = 'gemini-flash';

/**
 * Gemini-only helper for creating a Google GenAI client for runtime summarizers.
 *
 * Note: This is intentionally *not* a cross-provider helper. It supports multiple
 * Gemini models (Flash/Pro/etc.) by allowing callers to override `profileId`/`model`.
 */
export const getGeminiClient = async (secrets: SecretRegistry, options: GeminiClientOptions): Promise<LLMClient> => {
  const profileId = options.profileId ?? DEFAULT_GEMINI_PROFILE_ID;
  const model = options.model ?? profileId;

  const factory = new LLMFactory(
    {
      profileId,
      model,
      usageId: options.usageId,
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens,
    },
    {
      secrets,
      // Prefer the provider-specific key so a user's primary LLM key (often OpenAI) doesn't
      // accidentally override Gemini summarizers when both are configured.
      preferredApiKeys: 'GEMINI_API_KEY',
    }
  );

  return factory.createClient();
};
