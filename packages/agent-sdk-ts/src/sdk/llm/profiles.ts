import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LLMConfiguration, LLMProvider, OpenAIChatApi, ReasoningSummary } from './types';

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

export const validateProfile = (payload: unknown): LLMConfiguration => {
  if (!isObjectRecord(payload)) {
    throw new LLMProfileValidationError('Profile payload must be an object');
  }

  if (typeof payload.model !== 'string' || !payload.model.trim()) {
    throw new LLMProfileValidationError('Profile must include a non-empty "model" string');
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

  if ('apiKey' in payload && payload.apiKey !== undefined) {
    if (typeof payload.apiKey !== 'string') {
      throw new LLMProfileValidationError('apiKey must be a string');
    }
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

  return payload as unknown as LLMConfiguration;
};

const stripSecrets = (config: LLMConfiguration): LLMConfiguration => {
  const sanitized: LLMConfiguration = { ...config };
  if (typeof sanitized.apiKey === 'string' && !/^[A-Z0-9_]+$/.test(sanitized.apiKey)) {
    delete sanitized.apiKey;
  }
  return sanitized;
};

export const listProfiles = (options: LLMProfileStoreOptions = {}): string[] => {
  const rootDir = resolveRootDir(options);
  if (!fs.existsSync(rootDir)) return [];

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));
};

export const loadProfile = (profileId: string, options: LLMProfileStoreOptions = {}): LLMProfile => {
  const rootDir = resolveRootDir(options);
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
