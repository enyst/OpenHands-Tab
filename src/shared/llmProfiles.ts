import type { OpenHandsSettings } from '@smolpaws/agent-sdk';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

export const getConfiguredProfileId = (settings: OpenHandsSettings): string | undefined =>
  toOptionalNonEmptyString(settings.llm?.profileId);

export const resolveConfiguredLlmLabel = (settings: OpenHandsSettings): string | null => {
  const profileId = getConfiguredProfileId(settings);
  if (profileId) return profileId;

  return toOptionalNonEmptyString(settings.llm?.model) ?? null;
};
