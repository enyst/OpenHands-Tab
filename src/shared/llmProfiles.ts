import { loadProfile } from '@openhands/agent-sdk-ts';
import type { OpenHandsSettings } from '@openhands/agent-sdk-ts';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

export const getConfiguredProfileId = (settings: OpenHandsSettings): string | undefined =>
  toOptionalNonEmptyString(settings.llm?.profileId);

export const resolveConfiguredLlmLabel = (settings: OpenHandsSettings): string | null => {
  const profileId = getConfiguredProfileId(settings);
  if (profileId) {
    try {
      const profile = loadProfile(profileId);
      return toOptionalNonEmptyString(profile.config.profileName) ?? profileId;
    } catch {
      return profileId;
    }
  }

  return toOptionalNonEmptyString(settings.llm?.model) ?? null;
};

