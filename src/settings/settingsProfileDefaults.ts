import type { LLMConfiguration, LLMProfileStoreOptions } from '@openhands/agent-sdk-ts';
import { ensureDefaultProfiles, listProfiles, loadProfile } from '@openhands/agent-sdk-ts';
import { isSafeProfileId } from './settingsNormalization';

export const DEFAULT_LLM_PROFILE_ID = 'sonnet-45';

const DEFAULT_LLM_PROFILE_ID_BY_API_KEY: Array<{ secretKey: string; profileId: string }> = [
  { secretKey: 'OPENAI_API_KEY', profileId: 'gpt-5-mini' },
  { secretKey: 'ANTHROPIC_API_KEY', profileId: 'sonnet-45' },
  { secretKey: 'GEMINI_API_KEY', profileId: 'gemini-flash' },
];

const buildProfileStoreOptions = (llmProfileStoreRoot?: string): LLMProfileStoreOptions =>
  llmProfileStoreRoot ? { rootDir: llmProfileStoreRoot } : {};

const seedDefaultProfilesForCustomRoot = (
  llmProfileStoreRoot: string | undefined,
  options: LLMProfileStoreOptions,
): void => {
  if (!llmProfileStoreRoot) return;

  try {
    ensureDefaultProfiles(options);
  } catch {
    // Best-effort seeding; not all environments can write to the profile store.
  }
};

export const pickDefaultProfileId = async (
  llmProfileStoreRoot: string | undefined,
  hasSecret: (key: string) => Promise<boolean>,
): Promise<string> => {
  const profileOptions = buildProfileStoreOptions(llmProfileStoreRoot);
  seedDefaultProfilesForCustomRoot(llmProfileStoreRoot, profileOptions);

  // If a user set a per-profile API key (via the Profiles UI) before explicitly selecting a profile,
  // prefer that profile as the default on startup.
  for (const profileId of listProfiles(profileOptions)) {
    if (await hasSecret(`openhands.llmProfileApiKey.${profileId}`)) return profileId;
  }

  for (const entry of DEFAULT_LLM_PROFILE_ID_BY_API_KEY) {
    if (await hasSecret(entry.secretKey)) return entry.profileId;
  }

  return DEFAULT_LLM_PROFILE_ID;
};

export const loadSelectedProfileConfig = (
  profileId: string | undefined,
  llmProfileStoreRoot?: string,
): LLMConfiguration | undefined => {
  const candidateProfileId = profileId?.trim();
  if (!candidateProfileId || !isSafeProfileId(candidateProfileId)) return undefined;

  const options = buildProfileStoreOptions(llmProfileStoreRoot);
  seedDefaultProfilesForCustomRoot(llmProfileStoreRoot, options);

  try {
    return loadProfile(candidateProfileId, options).config;
  } catch {
    return undefined;
  }
};
