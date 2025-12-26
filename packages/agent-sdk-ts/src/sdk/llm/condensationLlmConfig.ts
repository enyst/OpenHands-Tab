import type { OpenHandsSettings } from '../types/settings';
import type { LLMProvider } from './types';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl } from './provider';
import { loadProfile } from './profiles';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const isSafeProfileId = (profileId: string): boolean => {
  if (!profileId.trim()) return false;
  if (profileId !== profileId.trim()) return false;
  if (profileId.includes('/') || profileId.includes('\\')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(profileId);
};

const toOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
};

export function getEffectiveLlmConfigForCondensation(settings: OpenHandsSettings): {
  provider: LLMProvider | undefined;
  baseUrl: string | undefined;
  model: string;
  openaiApiMode: unknown;
  maxInputTokens: number | undefined;
} {
  const llm = settings.llm ?? {};
  const configuredBaseUrl = toOptionalNonEmptyString(llm.baseUrl);
  const configuredModel = toOptionalNonEmptyString(llm.model) ?? '';
  const configuredProvider = llm.provider ?? undefined;
  const configuredOpenaiApiMode = (llm as { openaiApiMode?: unknown } | undefined)?.openaiApiMode;
  const configuredMaxInputTokens = toOptionalPositiveInteger(llm.maxInputTokens);

  const profileId = toOptionalNonEmptyString(llm.profileId);
  if (!profileId || !isSafeProfileId(profileId)) {
    const provider = configuredProvider ?? detectProviderFromBaseUrl(configuredBaseUrl);
    return {
      provider,
      baseUrl: configuredBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider],
      model: configuredModel,
      openaiApiMode: configuredOpenaiApiMode,
      maxInputTokens: configuredMaxInputTokens,
    };
  }

  try {
    const profile = loadProfile(profileId);
    const profileModel = toOptionalNonEmptyString(profile.config.model) ?? configuredModel;
    const profileBaseUrl = toOptionalNonEmptyString(profile.config.baseUrl);
    const profileProvider = profile.config.provider ?? detectProviderFromBaseUrl(profileBaseUrl ?? configuredBaseUrl);
    const profileMaxInputTokens = toOptionalPositiveInteger(profile.config.maxInputTokens);
    return {
      provider: profileProvider,
      baseUrl: profileBaseUrl ?? configuredBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[profileProvider],
      model: profileModel,
      openaiApiMode: profile.config.openaiApiMode ?? configuredOpenaiApiMode,
      maxInputTokens: profileMaxInputTokens ?? configuredMaxInputTokens,
    };
  } catch {
    const provider = configuredProvider ?? detectProviderFromBaseUrl(configuredBaseUrl);
    return {
      provider,
      baseUrl: configuredBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider],
      model: configuredModel,
      openaiApiMode: configuredOpenaiApiMode,
      maxInputTokens: configuredMaxInputTokens,
    };
  }
}
