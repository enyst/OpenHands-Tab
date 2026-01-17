import {
  deleteProfile as deleteSdkProfile,
  listProfiles as listSdkProfiles,
  loadProfile as loadSdkProfile,
  saveProfile as saveSdkProfile,
  validateProfile,
  type LLMConfiguration,
  type LLMProfileStoreOptions,
  type SaveProfileOptions,
} from '@openhands/agent-sdk-ts';

export type HostLlmProfileSaveOptions = LLMProfileStoreOptions & {
  /** When true, allow inline secrets (apiKeyRef.kind="inline"/headers) to be persisted to disk. */
  includeSecrets?: boolean;
};

const stripSecrets = (config: LLMConfiguration): LLMConfiguration => {
  const sanitized: LLMConfiguration = { ...config };
  if (sanitized.apiKeyRef?.kind === 'inline') {
    delete sanitized.apiKeyRef;
  }
  // Headers can plausibly contain auth material (Authorization, x-api-key, etc.).
  // In "no secrets" mode, be conservative and do not send/persist headers.
  delete sanitized.headers;
  return sanitized;
};

const toSdkStoreOptions = (options: LLMProfileStoreOptions = {}): LLMProfileStoreOptions => (
  options.rootDir ? { rootDir: options.rootDir } : {}
);

const toSdkSaveOptions = (options: HostLlmProfileSaveOptions = {}): SaveProfileOptions => {
  const includeSecrets = options.includeSecrets ?? false;
  return options.rootDir ? { rootDir: options.rootDir, includeSecrets } : { includeSecrets };
};

export const listProfiles = (options: LLMProfileStoreOptions = {}): string[] =>
  listSdkProfiles(toSdkStoreOptions(options));

export const loadProfile = (
  profileId: string,
  options: LLMProfileStoreOptions = {},
): { profileId: string; config: LLMConfiguration } => {
  const profile = loadSdkProfile(profileId, toSdkStoreOptions(options));
  return { profileId: profile.profileId, config: stripSecrets(profile.config) };
};

export const saveProfile = (
  profileId: string,
  payload: unknown,
  options: HostLlmProfileSaveOptions = {},
): void => {
  const config = validateProfile(payload);
  saveSdkProfile(profileId, config, toSdkSaveOptions(options));
};

export const deleteProfile = (profileId: string, options: LLMProfileStoreOptions = {}): void =>
  deleteSdkProfile(profileId, toSdkStoreOptions(options));
