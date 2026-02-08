import { assertValidProfileId } from '../llm/profiles';

export const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const isSafeProfileId = (profileId: string): boolean => {
  try {
    assertValidProfileId(profileId);
    return true;
  } catch {
    return false;
  }
};

