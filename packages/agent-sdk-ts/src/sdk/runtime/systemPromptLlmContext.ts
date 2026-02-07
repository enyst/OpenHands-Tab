import { detectProviderFromBaseUrl, loadProfile, type LLMProfileStoreOptions } from '../llm';
import type { OpenHandsSettings } from '../types/settings';
import { isSafeProfileId, toOptionalNonEmptyString } from './settingsUtils';

export type SystemPromptLlmContext = {
  llmModel: string | null;
  llmProvider: string | null;
  llmBaseUrl: string | null;
};

export function resolveSystemPromptLlmContext(
  settings: OpenHandsSettings | undefined,
  profileStoreOptions: LLMProfileStoreOptions | undefined,
): SystemPromptLlmContext {
  const llmSettings = settings?.llm;
  const profileId = toOptionalNonEmptyString(llmSettings?.profileId);
  let llmModel = toOptionalNonEmptyString(llmSettings?.model) ?? null;
  let llmProvider = toOptionalNonEmptyString(llmSettings?.provider) ?? null;
  let llmBaseUrl = toOptionalNonEmptyString(llmSettings?.baseUrl) ?? null;

  // When profileId is set, raw model/provider/baseUrl can be intentionally cleared (profiles-first).
  // Load the profile config (when safe) so vendor-specific repo skills are gated correctly.
  if (profileId && isSafeProfileId(profileId)) {
    try {
      const profile = loadProfile(profileId, profileStoreOptions);
      llmModel = toOptionalNonEmptyString(profile.config.model) ?? llmModel;
      llmProvider = toOptionalNonEmptyString(profile.config.provider) ?? llmProvider;
      llmBaseUrl = toOptionalNonEmptyString(profile.config.baseUrl) ?? llmBaseUrl;
    } catch {
      // Best-effort: profile loading failures will surface elsewhere when creating the LLM client.
    }
  }

  llmProvider = llmProvider ?? detectProviderFromBaseUrl(llmBaseUrl ?? undefined);
  return { llmModel, llmProvider, llmBaseUrl };
}
