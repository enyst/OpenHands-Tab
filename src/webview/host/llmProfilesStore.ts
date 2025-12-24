import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_LLM_PROFILES_DIR,
  LLMProfileValidationError,
  listProfiles as listSdkProfiles,
  loadProfile as loadSdkProfile,
  saveProfile as saveSdkProfile,
  validateProfile,
  type LLMConfiguration,
  type LLMProfileStoreOptions,
  type SaveProfileOptions,
} from '@openhands/agent-sdk-ts';

export type HostLlmProfileStoreOptions = LLMProfileStoreOptions & {
  /** When true, allow inline secrets (apiKey/headers) to be returned or persisted. */
  includeSecrets?: boolean;
};

const expandHomeDir = (value: string): string => {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
};

const resolveRootDir = (options: LLMProfileStoreOptions = {}): string => {
  const rootDir = options.rootDir ?? DEFAULT_LLM_PROFILES_DIR;
  return path.resolve(expandHomeDir(rootDir));
};

const assertValidProfileId = (profileId: string): void => {
  if (!profileId.trim()) {
    throw new LLMProfileValidationError('Profile id must be a non-empty string');
  }
  if (profileId !== profileId.trim()) {
    throw new LLMProfileValidationError('Profile id must not have leading/trailing whitespace');
  }
  if (profileId.includes('/') || profileId.includes('\\')) {
    throw new LLMProfileValidationError('Profile id must not contain path separators');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(profileId)) {
    throw new LLMProfileValidationError('Profile id contains invalid characters');
  }
};

const getProfilePath = (profileId: string, rootDir: string): string => {
  assertValidProfileId(profileId);
  const normalizedRootDir = path.resolve(rootDir);
  const candidate = path.resolve(normalizedRootDir, `${profileId}.json`);
  const rootWithSep = normalizedRootDir.endsWith(path.sep)
    ? normalizedRootDir
    : `${normalizedRootDir}${path.sep}`;
  if (!candidate.startsWith(rootWithSep)) {
    throw new LLMProfileValidationError('Profile id resolves outside the profile root directory');
  }
  return candidate;
};

const stripSecrets = (config: LLMConfiguration): LLMConfiguration => {
  const sanitized: LLMConfiguration = { ...config };
  if (typeof sanitized.apiKey === 'string' && !/^[A-Z0-9_]+$/.test(sanitized.apiKey)) {
    delete sanitized.apiKey;
  }
  // Headers can plausibly contain auth material (Authorization, x-api-key, etc.).
  // In "no secrets" mode, be conservative and do not send/persist headers.
  delete sanitized.headers;
  return sanitized;
};

const toSdkStoreOptions = (options: LLMProfileStoreOptions = {}): LLMProfileStoreOptions => (
  options.rootDir ? { rootDir: options.rootDir } : {}
);

const toSdkSaveOptions = (options: HostLlmProfileStoreOptions = {}): SaveProfileOptions => {
  const includeSecrets = options.includeSecrets ?? false;
  return options.rootDir ? { rootDir: options.rootDir, includeSecrets } : { includeSecrets };
};

export const listProfiles = (options: LLMProfileStoreOptions = {}): string[] =>
  listSdkProfiles(toSdkStoreOptions(options));

export const loadProfile = (
  profileId: string,
  options: HostLlmProfileStoreOptions = {},
): { profileId: string; config: LLMConfiguration } => {
  const profile = loadSdkProfile(profileId, toSdkStoreOptions(options));
  const config = options.includeSecrets ? profile.config : stripSecrets(profile.config);
  return { profileId: profile.profileId, config };
};

export const saveProfile = (
  profileId: string,
  payload: unknown,
  options: HostLlmProfileStoreOptions = {},
): void => {
  const config = validateProfile(payload);
  saveSdkProfile(profileId, config, toSdkSaveOptions(options));
};

export const deleteProfile = async (profileId: string, options: LLMProfileStoreOptions = {}): Promise<void> => {
  const rootDir = resolveRootDir(options);
  const filePath = getProfilePath(profileId, rootDir);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (code === 'ENOENT') {
      throw new LLMProfileValidationError(`Profile '${profileId}' not found`);
    }
    throw err;
  }
};

