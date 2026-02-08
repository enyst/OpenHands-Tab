import type { LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import type { SecretRegistry } from './SecretRegistry';

export interface GeminiClientOptions {
  usageId: string;
  profileId?: string;
}

const DEFAULT_GEMINI_SUMMARIZER_PROFILE_ID = 'gemini-flash-summarizer';

/**
 * Gemini-only helper for creating a Google GenAI client for runtime summarizers.
 *
 * Note: This is intentionally *not* a cross-provider helper. It is intended for
 * deterministic summarizers that should derive model + generation config from a
 * selected profile (not per-call overrides).
 */
export const getGeminiClient = async (secrets: SecretRegistry, options: GeminiClientOptions): Promise<LLMClient> => {
  const profileId = options.profileId ?? DEFAULT_GEMINI_SUMMARIZER_PROFILE_ID;

  const factory = new LLMFactory(
    {
      profileId,
      usageId: options.usageId,
      // NOTE: `model` is required by the type but is sourced from the profile when
      // `profileId` is present (LLMFactory ignores the override).
      model: profileId,
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
