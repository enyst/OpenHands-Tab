import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ApiKeyRef, LLMConfiguration, LLMProvider, OpenAIChatApi, ReasoningSummary } from './types';
import { DEFAULT_PROVIDER_BASE_URLS } from './provider';

export const DEFAULT_LLM_PROFILES_DIR = path.join(os.homedir(), '.openhands', 'llm-profiles');

export interface LLMProfile {
  profileId: string;
  config: LLMConfiguration;
}

export class LLMProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMProfileValidationError';
  }
}

export interface LLMProfileStoreOptions {
  rootDir?: string;
}

export interface SaveProfileOptions extends LLMProfileStoreOptions {
  includeSecrets?: boolean;
}

const warnedOnce = new Set<string>();

const warnOnce = (key: string, message: string, error: unknown): void => {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message, error);
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

export const assertValidProfileId = (profileId: string): void => {
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

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const LLM_PROVIDERS: readonly LLMProvider[] = [
  'openai',
  'litellm_proxy',
  'openrouter',
  'anthropic',
  'gemini',
];

const isLLMProvider = (value: unknown): value is LLMProvider =>
  typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value);

const OPENAI_API_MODES: readonly OpenAIChatApi[] = ['chat_completions', 'responses'];

const isOpenAIApiMode = (value: unknown): value is OpenAIChatApi =>
  typeof value === 'string' && (OPENAI_API_MODES as readonly string[]).includes(value);

const REASONING_SUMMARIES: readonly ReasoningSummary[] = ['auto', 'concise', 'detailed'];

const isReasoningSummary = (value: unknown): value is ReasoningSummary =>
  typeof value === 'string' && (REASONING_SUMMARIES as readonly string[]).includes(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const validateHeaders = (headers: unknown): void => {
  if (!isObjectRecord(headers)) {
    throw new LLMProfileValidationError('headers must be an object mapping string keys to string values');
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new LLMProfileValidationError('headers must be an object mapping string keys to string values');
    }
  }
};

const validateApiKeyRef = (value: unknown): void => {
  if (!isObjectRecord(value)) {
    throw new LLMProfileValidationError('apiKeyRef must be an object');
  }
  const kind = value.kind;
  if (kind === 'inline') {
    if (typeof value.value !== 'string' || !value.value.trim()) {
      throw new LLMProfileValidationError('apiKeyRef.value must be a non-empty string when kind="inline"');
    }
    return;
  }
  if (kind === 'key') {
    if (typeof value.name !== 'string' || !value.name.trim()) {
      throw new LLMProfileValidationError('apiKeyRef.name must be a non-empty string when kind="key"');
    }
    return;
  }
  throw new LLMProfileValidationError('apiKeyRef.kind must be "key" or "inline"');
};

export const validateProfile = (payload: unknown): LLMConfiguration => {
  if (!isObjectRecord(payload)) {
    throw new LLMProfileValidationError('Profile payload must be an object');
  }

  const config = payload;

  if (typeof payload.model !== 'string' || !payload.model.trim()) {
    throw new LLMProfileValidationError('Profile must include a non-empty "model" string');
  }

  if ('profileId' in payload && payload.profileId !== undefined && payload.profileId !== null) {
    if (typeof payload.profileId !== 'string') {
      throw new LLMProfileValidationError('profileId must be a string or null');
    }
    assertValidProfileId(payload.profileId);
  }

  if ('provider' in payload && payload.provider !== undefined && payload.provider !== null) {
    if (!isLLMProvider(payload.provider)) {
      throw new LLMProfileValidationError(`Unsupported provider: ${JSON.stringify(payload.provider)}`);
    }
  }

  if ('usageId' in payload && payload.usageId !== undefined && payload.usageId !== null) {
    if (typeof payload.usageId !== 'string') {
      throw new LLMProfileValidationError('usageId must be a string or null');
    }
  }

  if ('openaiApiMode' in payload && payload.openaiApiMode !== undefined && payload.openaiApiMode !== null) {
    if (!isOpenAIApiMode(payload.openaiApiMode)) {
      throw new LLMProfileValidationError('openaiApiMode must be "chat_completions", "responses", or null');
    }
  }

  for (const key of ['baseUrl', 'apiVersion'] as const) {
    if (key in payload && payload[key] !== undefined) {
      if (!isNullableString(payload[key])) {
        throw new LLMProfileValidationError(`${key} must be a string or null`);
      }
    }
  }

  if ('apiKeyRef' in config && config.apiKeyRef !== undefined && config.apiKeyRef !== null) {
    validateApiKeyRef(config.apiKeyRef);
  }
  // Backward-compat: treat legacy `apiKey` as a reference name, not an inline secret value.
  if ('apiKey' in config && config.apiKey !== undefined) {
    if (typeof config.apiKey !== 'string') {
      throw new LLMProfileValidationError('apiKey must be a string');
    }
    const name = config.apiKey.trim();
    if (name && config.apiKeyRef === undefined) {
      config.apiKeyRef = { kind: 'key', name } satisfies ApiKeyRef;
    }
    delete config.apiKey;
  }

  for (const key of ['timeoutSeconds', 'temperature', 'topP', 'topK'] as const) {
    if (key in payload && payload[key] !== undefined) {
      if (!isNullableNumber(payload[key])) {
        throw new LLMProfileValidationError(`${key} must be a number or null`);
      }
    }
  }

  for (const key of ['maxInputTokens', 'maxOutputTokens'] as const) {
    if (key in payload && payload[key] !== undefined) {
      if (!isNullableNumber(payload[key])) {
        throw new LLMProfileValidationError(`${key} must be a number or null`);
      }
    }
  }

  if ('reasoningEffort' in payload && payload.reasoningEffort !== undefined && payload.reasoningEffort !== null) {
    if (
      typeof payload.reasoningEffort !== 'string' ||
      !['low', 'medium', 'high', 'none'].includes(payload.reasoningEffort)
    ) {
      throw new LLMProfileValidationError('reasoningEffort must be "low", "medium", "high", "none", or null');
    }
  }

  if (
    'reasoningSummary' in payload &&
    payload.reasoningSummary !== undefined &&
    payload.reasoningSummary !== null
  ) {
    if (!isReasoningSummary(payload.reasoningSummary)) {
      throw new LLMProfileValidationError('reasoningSummary must be "auto", "concise", "detailed", or null');
    }
  }

  if ('headers' in payload && payload.headers !== undefined) {
    validateHeaders(payload.headers);
  }

  for (const key of ['inputCostPerToken', 'outputCostPerToken'] as const) {
    if (key in payload && payload[key] !== undefined) {
      if (!isNullableNumber(payload[key])) {
        throw new LLMProfileValidationError(`${key} must be a number or null`);
      }
    }
  }

  return config as unknown as LLMConfiguration;
};

const stripSecrets = (config: LLMConfiguration): LLMConfiguration => {
  const sanitized: LLMConfiguration = { ...config };
  if (sanitized.apiKeyRef?.kind === 'inline') {
    delete sanitized.apiKeyRef;
  }
  // Headers can plausibly contain auth material (Authorization, x-api-key, etc.).
  // In "no secrets" mode, be conservative and do not persist headers.
  delete sanitized.headers;
  return sanitized;
};

const ensureDefaultProfilesForDefaultStore = (rootDir: string, options: LLMProfileStoreOptions): void => {
  if (options.rootDir) return;
  try {
    ensureDefaultProfiles({ ...options, rootDir });
  } catch (error) {
    warnOnce(
      `ensure-default-profiles:${rootDir}`,
      `[agent-sdk] Failed to ensure default LLM profiles in ${rootDir}:`,
      error,
    );
  }
};

/**
 * Lists available LLM profile ids.
 *
 * When using the default store (`~/.openhands/llm-profiles`), this will best-effort seed a few
 * canonical profiles on first use.
 */
export const listProfiles = (options: LLMProfileStoreOptions = {}): string[] => {
  const rootDir = resolveRootDir(options);
  ensureDefaultProfilesForDefaultStore(rootDir, options);
  if (!fs.existsSync(rootDir)) return [];

  const profileIds: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const profileId = entry.name.slice(0, -'.json'.length);
    try {
      assertValidProfileId(profileId);
      profileIds.push(profileId);
    } catch {
      // Ignore files that cannot possibly be loaded.
    }
  }
  return profileIds.sort((a, b) => a.localeCompare(b));
};

/**
 * Loads an LLM profile stored on disk.
 *
 * When using the default store (`~/.openhands/llm-profiles`), this will best-effort seed a few
 * canonical profiles on first use.
 */
export const loadProfile = (profileId: string, options: LLMProfileStoreOptions = {}): LLMProfile => {
  const rootDir = resolveRootDir(options);
  ensureDefaultProfilesForDefaultStore(rootDir, options);
  const filePath = getProfilePath(profileId, rootDir);
  if (!fs.existsSync(filePath)) {
    throw new LLMProfileValidationError(`Profile '${profileId}' not found`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  let payload: unknown;
  try {
    payload = JSON.parse(content) as unknown;
  } catch (error) {
    throw new LLMProfileValidationError(
      `Profile '${profileId}' contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const config = validateProfile(payload);
  return { profileId, config };
};

export const saveProfile = (
  profileId: string,
  config: LLMConfiguration,
  options: SaveProfileOptions = {},
): void => {
  const rootDir = resolveRootDir(options);
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const filePath = getProfilePath(profileId, rootDir);

  const includeSecrets = options.includeSecrets ?? false;
  const payload = includeSecrets ? { ...config } : stripSecrets(config);
  delete (payload as { profileId?: unknown }).profileId;
  delete (payload as { profileName?: unknown }).profileName;
  validateProfile(payload);

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, json, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup.
    }
    throw error;
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort on platforms that support chmod.
  }
};

/**
 * Deletes an LLM profile stored on disk.
 *
 * Note: this does not remove any out-of-band secrets (API keys) stored elsewhere.
 */
export const deleteProfile = (profileId: string, options: LLMProfileStoreOptions = {}): void => {
  const rootDir = resolveRootDir(options);
  const filePath = getProfilePath(profileId, rootDir);
  if (!fs.existsSync(filePath)) {
    throw new LLMProfileValidationError(`Profile '${profileId}' not found`);
  }
  fs.unlinkSync(filePath);
};

export const DEFAULT_LLM_PROFILE_IDS = [
  'gemini-flash',
  'gemini-flash-hal',
  'gemini-flash-summarizer',
  'gpt-5',
  'gpt-5-mini',
  'sonnet-45',
] as const;

export type DefaultLlmProfileId = typeof DEFAULT_LLM_PROFILE_IDS[number];

const DEFAULT_LLM_PROFILES: Array<{ profileId: DefaultLlmProfileId; config: LLMConfiguration }> = [
  {
    profileId: 'gemini-flash',
    config: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini,
    },
  },
  {
    profileId: 'gemini-flash-hal',
    config: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini,
    },
  },
  {
    profileId: 'gemini-flash-summarizer',
    config: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.gemini,
      temperature: 0.2,
      maxOutputTokens: 512,
    },
  },
  {
    profileId: 'gpt-5',
    config: {
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.openai,
    },
  },
  {
    profileId: 'gpt-5-mini',
    config: {
      provider: 'openai',
      model: 'gpt-5-mini',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.openai,
    },
  },
  {
    profileId: 'sonnet-45',
    config: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: DEFAULT_PROVIDER_BASE_URLS.anthropic,
    },
  },
];

export const ensureDefaultProfiles = (options: LLMProfileStoreOptions = {}): DefaultLlmProfileId[] => {
  const rootDir = resolveRootDir(options);
  const created: DefaultLlmProfileId[] = [];

  for (const entry of DEFAULT_LLM_PROFILES) {
    try {
      const filePath = getProfilePath(entry.profileId, rootDir);
      if (fs.existsSync(filePath)) continue;
      saveProfile(entry.profileId, entry.config, { ...options, includeSecrets: false });
      created.push(entry.profileId);
    } catch (error) {
      // Best-effort; users may have a read-only profile directory.
      warnOnce(
        `create-default-profile:${rootDir}:${entry.profileId}`,
        `[agent-sdk] Failed to create default LLM profile '${entry.profileId}':`,
        error,
      );
    }
  }

  return created;
};
