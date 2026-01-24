import type { SettingsAdapter, LLMSettings, ServerSettings, AgentSettings, ConversationSettings, ConfirmationSettings } from './SettingsAdapter';
import type { HalMode } from '../shared/halTypes';
import { DEFAULT_HAL_LLM_PROFILE_ID } from '../shared/halDefaults';
import { normalizeServerUrl } from '../shared/serverUrls';
import { normalizeNonEmptyString } from '../shared/stringUtils';
import { detectProviderFromBaseUrl, ensureDefaultProfiles, listProfiles, loadProfile } from '@openhands/agent-sdk-ts';

export interface SavedServer {
  url: string;
  label?: string;
}

export type HalSettings = {
  enabled: boolean;
  mode: HalMode;
  llmProfileId: string;
  userName: string;
  voiceAId?: string;
  voiceUserId?: string;
  modelId?: string;
  volume: number;
  cache: boolean;
};

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  oracle?: { profileId?: string | null };
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  hal: HalSettings;
  servers: SavedServer[];
  secrets: {
    /**
     * Remote-mode credentials are injected by the extension host at runtime.
     *
     * These values are intentionally not persisted via `SettingsManager.update()` because they
     * live in per-server VS Code SecretStorage slots.
     */
    cloudApiKey?: string;
    runtimeSessionApiKey?: string;
    llmApiKey?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    githubToken?: string;
    halTtsApiKey?: string;
    customSecret1?: string;
    customSecret2?: string;
    customSecret3?: string;
  };
};

const DEFAULTS: OpenHandsSettings = {
  serverUrl: '',
  servers: [],
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  oracle: { profileId: null },
  agent: { enableSecurityAnalyzer: true, debug: false, summarizeToolCalls: false },
  conversation: { maxIterations: 50 },
  confirmation: { policy: 'never', riskyThreshold: 'MEDIUM', confirmUnknown: true },
  hal: { enabled: false, mode: 'tts_only', llmProfileId: DEFAULT_HAL_LLM_PROFILE_ID, userName: 'Engel', volume: 1, cache: true },
  secrets: {}
};

const DEFAULT_LLM_PROFILE_ID = 'sonnet-45';

const DEFAULT_LLM_PROFILE_ID_BY_API_KEY: Array<{ secretKey: string; profileId: string }> = [
  { secretKey: 'OPENAI_API_KEY', profileId: 'gpt-5-mini' },
  { secretKey: 'ANTHROPIC_API_KEY', profileId: 'sonnet-45' },
  { secretKey: 'GEMINI_API_KEY', profileId: 'gemini-flash' },
];

const HAL_CONFIG_UPDATES: Array<[keyof HalSettings, string]> = [
  ['enabled', 'openhands.hal.enabled'],
  ['mode', 'openhands.hal.mode'],
  ['llmProfileId', 'openhands.hal.llmProfileId'],
  ['userName', 'openhands.hal.userName'],
  ['voiceAId', 'openhands.hal.voiceAId'],
  ['voiceUserId', 'openhands.hal.voiceUserId'],
  ['modelId', 'openhands.hal.modelId'],
  ['volume', 'openhands.hal.volume'],
  ['cache', 'openhands.hal.cache'],
];

const SECRET_STORAGE_KEYS: Array<{ key: keyof OpenHandsSettings['secrets']; storageKey: string }> = [
  { key: 'llmApiKey', storageKey: 'openhands.llmApiKey' },
  { key: 'awsAccessKeyId', storageKey: 'openhands.awsAccessKeyId' },
  { key: 'awsSecretAccessKey', storageKey: 'openhands.awsSecretAccessKey' },
  { key: 'githubToken', storageKey: 'openhands.githubToken' },
  { key: 'halTtsApiKey', storageKey: 'openhands.hal.ttsApiKey' },
  { key: 'customSecret1', storageKey: 'openhands.customSecret1' },
  { key: 'customSecret2', storageKey: 'openhands.customSecret2' },
  { key: 'customSecret3', storageKey: 'openhands.customSecret3' },
];

const isSafeProfileId = (value: string): boolean => {
  if (!value.trim()) return false;
  if (value !== value.trim()) return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(value);
};

const sanitizePositiveInteger = (value: number | null | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const int = Math.trunc(value);
  return int > 0 ? int : undefined;
};

const normalizeHalMode = (value: unknown, defaultValue: HalMode): HalMode => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  switch (trimmed) {
    case 'bundled':
    case 'tts_only':
    case 'voice_confirm':
      return trimmed;
    default:
      return defaultValue;
  }
};

const clampUnitInterval = (value: number | null | undefined, defaultValue: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.min(1, Math.max(0, value));
};

const normalizeSavedServers = (value: unknown, defaultValue: SavedServer[]): { servers: SavedServer[]; changed: boolean; dropped: number } => {
  if (!Array.isArray(value)) return { servers: defaultValue, changed: true, dropped: 0 };

  const byUrl = new Map<string, SavedServer>();
  let changed = false;
  let dropped = 0;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      changed = true;
      dropped += 1;
      continue;
    }

    const candidate = entry as Partial<Record<keyof SavedServer, unknown>>;
    const rawUrl = normalizeNonEmptyString(typeof candidate.url === 'string' ? candidate.url : undefined);
    if (!rawUrl) {
      changed = true;
      dropped += 1;
      continue;
    }

    const normalizedUrl = normalizeServerUrl(rawUrl);
    if (!normalizedUrl.ok) {
      changed = true;
      dropped += 1;
      continue;
    }

    const label = normalizeNonEmptyString(typeof candidate.label === 'string' ? candidate.label : undefined);
    if (normalizedUrl.url !== rawUrl) changed = true;

    const existing = byUrl.get(normalizedUrl.url);
    if (existing) {
      // Deduplicate by canonical URL; preserve an existing label, but upgrade if we encounter one later.
      if (!existing.label && label) {
        byUrl.set(normalizedUrl.url, { ...existing, label });
        changed = true;
      } else {
        changed = true;
      }
      continue;
    }

    byUrl.set(normalizedUrl.url, label ? { url: normalizedUrl.url, label } : { url: normalizedUrl.url });
  }

  return { servers: Array.from(byUrl.values()), changed, dropped };
};

export class SettingsManager {
  private serverNormalizationWarnings: string[] = [];
  private validationWarnings: string[] = [];

  constructor(
    private adapter: SettingsAdapter,
    private llmProfileStoreRoot?: string,
  ) {}

  private async pickDefaultProfileId(): Promise<string> {
    const hasSecret = async (key: string): Promise<boolean> => {
      try {
        const stored = await this.adapter.getSecret(key);
        if (typeof stored === 'string' && stored.trim()) return true;
      } catch {
        // ignore
      }
      const envValue = process.env[key];
      return typeof envValue === 'string' && envValue.trim().length > 0;
    };

    const profileOptions = this.llmProfileStoreRoot ? { rootDir: this.llmProfileStoreRoot } : {};

    // Ensure seeded defaults exist when using a non-default root (tests/custom dirs).
    if (this.llmProfileStoreRoot) {
      try {
        ensureDefaultProfiles(profileOptions);
      } catch {
        // Best-effort seeding; not all environments can write to the profile store.
      }
    }

    // If a user set a per-profile API key (via the Profiles UI) before explicitly selecting a profile,
    // prefer that profile as the default on startup.
    for (const profileId of listProfiles(profileOptions)) {
      if (await hasSecret(`openhands.llmProfileApiKey.${profileId}`)) return profileId;
    }

    for (const entry of DEFAULT_LLM_PROFILE_ID_BY_API_KEY) {
      if (await hasSecret(entry.secretKey)) return entry.profileId;
    }

    return DEFAULT_LLM_PROFILE_ID;
  }

  drainServerNormalizationWarnings(): string[] {
    const warnings = [...this.serverNormalizationWarnings, ...this.validationWarnings];
    this.serverNormalizationWarnings = [];
    this.validationWarnings = [];
    return warnings;
  }

  async get(): Promise<OpenHandsSettings> {
    const warnings: string[] = [];

    const rawServerUrl = this.adapter.get<string | null>('openhands.serverUrl', DEFAULTS.serverUrl) ?? DEFAULTS.serverUrl;
    const trimmedServerUrl = normalizeNonEmptyString(rawServerUrl);
    let serverUrl: string | undefined;
    let serverUrlChanged = false;

    if (trimmedServerUrl) {
      const normalized = normalizeServerUrl(trimmedServerUrl);
      if (normalized.ok) {
        serverUrl = normalized.url;
        if (serverUrl !== trimmedServerUrl) serverUrlChanged = true;
      } else {
        warnings.push(`Invalid server URL: ${normalized.error}`);
        serverUrlChanged = true;
      }
    }

    const rawServers = this.adapter.get<unknown>('openhands.servers', DEFAULTS.servers) ?? DEFAULTS.servers;
    const serversResult = normalizeSavedServers(rawServers, DEFAULTS.servers);
    let servers = serversResult.servers;
    let serversChanged = serversResult.changed;

    if (serversResult.dropped > 0) {
      warnings.push(`Dropped ${serversResult.dropped} invalid saved server entr${serversResult.dropped === 1 ? 'y' : 'ies'}.`);
    }

    // If serverUrl is set, always ensure it appears in the servers list (even if manually configured in settings).
    if (serverUrl && !servers.some((s) => s.url === serverUrl)) {
      servers = [...servers, { url: serverUrl }];
      serversChanged = true;
    }

    if (serverUrlChanged || serversChanged) {
      this.serverNormalizationWarnings = warnings;
      try {
        await this.update({ serverUrl: serverUrl ?? '', servers }, 'global');
      } catch {
        // Best effort: still return normalized values even if persistence fails.
      }
    } else {
      this.serverNormalizationWarnings = [];
    }

    const configuredProfileId = normalizeNonEmptyString(this.adapter.getExplicit<string>('openhands.llm.profileId'));
    const profileId = configuredProfileId && isSafeProfileId(configuredProfileId)
      ? configuredProfileId
      : undefined;
    let effectiveProfileId = profileId;
    if (!effectiveProfileId) {
      effectiveProfileId = await this.pickDefaultProfileId();
      try {
        await this.update({ llm: { profileId: effectiveProfileId } }, 'global');
      } catch {
        // Best-effort: still return the computed id even if persistence fails.
      }
    }

    const profileConfig = (() => {
      const profileId = effectiveProfileId?.trim();
      if (!profileId || !isSafeProfileId(profileId)) return undefined;
      try {
        const options = this.llmProfileStoreRoot ? { rootDir: this.llmProfileStoreRoot } : {};
        if (this.llmProfileStoreRoot) {
          try {
            ensureDefaultProfiles(options);
          } catch {
            // Best-effort seeding for tests/custom dirs.
          }
        }
        return loadProfile(profileId, options).config;
      } catch {
        return undefined;
      }
    })();
    const provider = profileConfig?.provider ?? detectProviderFromBaseUrl(profileConfig?.baseUrl);

    const llm: LLMSettings = {
      profileId: effectiveProfileId,
      provider,
      model: profileConfig?.model,
      openaiApiMode: profileConfig?.openaiApiMode ?? undefined,
      baseUrl: normalizeNonEmptyString(profileConfig?.baseUrl ?? undefined),
      apiVersion: normalizeNonEmptyString(profileConfig?.apiVersion ?? undefined),
      timeout: profileConfig?.timeoutSeconds ?? undefined,
      temperature: profileConfig?.temperature ?? undefined,
      topP: profileConfig?.topP ?? undefined,
      topK: profileConfig?.topK ?? undefined,
      maxInputTokens: sanitizePositiveInteger(profileConfig?.maxInputTokens ?? undefined),
      maxOutputTokens: sanitizePositiveInteger(profileConfig?.maxOutputTokens ?? undefined),
      reasoningEffort: profileConfig?.reasoningEffort ?? undefined,
      reasoningSummary: profileConfig?.reasoningSummary ?? undefined,
      inputCostPerToken: profileConfig?.inputCostPerToken ?? undefined,
      outputCostPerToken: profileConfig?.outputCostPerToken ?? undefined,
    };

    const oracleWarnings: string[] = [];

    const explicitOracleProfileId = this.adapter.getExplicit<unknown>('openhands.oracle.profileId');
    if (explicitOracleProfileId === null) {
      oracleWarnings.push('Oracle profile id is null. Clear the setting or set a valid string.');
    }

    const rawOracleProfileId = explicitOracleProfileId === undefined
      ? this.adapter.get<unknown>('openhands.oracle.profileId', DEFAULTS.oracle?.profileId ?? null)
      : explicitOracleProfileId;

    const oracleProfileIdRaw = normalizeNonEmptyString(typeof rawOracleProfileId === 'string' ? rawOracleProfileId : undefined);
    const oracleProfileId = oracleProfileIdRaw && isSafeProfileId(oracleProfileIdRaw) ? oracleProfileIdRaw : undefined;
    if (oracleProfileIdRaw && !oracleProfileId) {
      oracleWarnings.push(`Invalid oracle LLM profile id: ${oracleProfileIdRaw}`);
    }
    this.validationWarnings = oracleWarnings;
    const oracle = { profileId: oracleProfileId };
    const agent: AgentSettings = {
      enableSecurityAnalyzer: this.adapter.get<boolean>('openhands.agent.enableSecurityAnalyzer', DEFAULTS.agent.enableSecurityAnalyzer) ?? DEFAULTS.agent.enableSecurityAnalyzer,
      debug: this.adapter.get<boolean>('openhands.agent.debug', DEFAULTS.agent.debug) ?? DEFAULTS.agent.debug,
      summarizeToolCalls: this.adapter.get<boolean>('openhands.agent.summarizeToolCalls', DEFAULTS.agent.summarizeToolCalls) ?? DEFAULTS.agent.summarizeToolCalls,
    };
    const conversation: ConversationSettings = {
      maxIterations: this.adapter.get<number>('openhands.conversation.maxIterations', DEFAULTS.conversation.maxIterations) ?? DEFAULTS.conversation.maxIterations,
    };
    const confirmation: ConfirmationSettings = {
      policy: this.adapter.get<'never' | 'always' | 'risky'>('openhands.confirmation.policy', DEFAULTS.confirmation.policy) ?? DEFAULTS.confirmation.policy,
      riskyThreshold: this.adapter.get<'LOW' | 'MEDIUM' | 'HIGH'>('openhands.confirmation.risky.threshold', DEFAULTS.confirmation.riskyThreshold) ?? DEFAULTS.confirmation.riskyThreshold,
      confirmUnknown: this.adapter.get<boolean>('openhands.confirmation.risky.confirmUnknown', DEFAULTS.confirmation.confirmUnknown) ?? DEFAULTS.confirmation.confirmUnknown,
    };
    const hal: HalSettings = {
      enabled: this.adapter.get<boolean>('openhands.hal.enabled', DEFAULTS.hal.enabled) ?? DEFAULTS.hal.enabled,
      mode: normalizeHalMode(
        this.adapter.get<unknown>('openhands.hal.mode', DEFAULTS.hal.mode) ?? DEFAULTS.hal.mode,
        DEFAULTS.hal.mode
      ),
      llmProfileId: normalizeNonEmptyString(
        this.adapter.get<string | null>('openhands.hal.llmProfileId', DEFAULTS.hal.llmProfileId)
      ) ?? DEFAULTS.hal.llmProfileId,
      userName: normalizeNonEmptyString(
        this.adapter.get<string | null>('openhands.hal.userName', DEFAULTS.hal.userName) ?? DEFAULTS.hal.userName
      ) ?? DEFAULTS.hal.userName,
      voiceAId: normalizeNonEmptyString(this.adapter.get<string | null>('openhands.hal.voiceAId', null) ?? undefined),
      voiceUserId: normalizeNonEmptyString(this.adapter.get<string | null>('openhands.hal.voiceUserId', null) ?? undefined),
      modelId: normalizeNonEmptyString(this.adapter.get<string | null>('openhands.hal.modelId', null) ?? undefined),
      volume: clampUnitInterval(
        this.adapter.get<number | null>('openhands.hal.volume', DEFAULTS.hal.volume) ?? DEFAULTS.hal.volume,
        DEFAULTS.hal.volume
      ),
      cache: this.adapter.get<boolean>('openhands.hal.cache', DEFAULTS.hal.cache) ?? DEFAULTS.hal.cache,
    };
    const secrets = {} as OpenHandsSettings['secrets'];
    for (const entry of SECRET_STORAGE_KEYS) {
      secrets[entry.key] = await this.adapter.getSecret(entry.storageKey);
    }
    return { serverUrl, servers, llm, oracle, agent, conversation, confirmation, hal, secrets };
  }

  async update(partial: Partial<OpenHandsSettings>, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    const ops: Promise<void>[] = [];

    if (partial.serverUrl !== undefined) {
      ops.push(this.adapter.update('openhands.serverUrl', partial.serverUrl ?? '', 'global'));
    }

    if (partial.servers !== undefined) {
      ops.push(this.adapter.update('openhands.servers', partial.servers, 'global'));
    }

    if (partial.llm) {
      if (partial.llm.profileId !== undefined) ops.push(this.adapter.update('openhands.llm.profileId', partial.llm.profileId, target));
    }

    if (partial.oracle) {
      if (partial.oracle.profileId !== undefined) {
        ops.push(this.adapter.update('openhands.oracle.profileId', partial.oracle.profileId ?? '', 'global'));
      }
    }

    if (partial.agent) {
      if (partial.agent.enableSecurityAnalyzer !== undefined) {
        ops.push(this.adapter.update('openhands.agent.enableSecurityAnalyzer', partial.agent.enableSecurityAnalyzer, target));
      }
      if (partial.agent.debug !== undefined) {
        ops.push(this.adapter.update('openhands.agent.debug', partial.agent.debug, target));
      }
      if (partial.agent.summarizeToolCalls !== undefined) {
        ops.push(this.adapter.update('openhands.agent.summarizeToolCalls', partial.agent.summarizeToolCalls, target));
      }
    }

    if (partial.conversation) {
      if (partial.conversation.maxIterations !== undefined) {
        ops.push(this.adapter.update('openhands.conversation.maxIterations', partial.conversation.maxIterations, target));
      }
    }

    if (partial.confirmation) {
      if (partial.confirmation.policy !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.policy', partial.confirmation.policy, target));
      }
      if (partial.confirmation.riskyThreshold !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.risky.threshold', partial.confirmation.riskyThreshold, target));
      }
      if (partial.confirmation.confirmUnknown !== undefined) {
        ops.push(this.adapter.update('openhands.confirmation.risky.confirmUnknown', partial.confirmation.confirmUnknown, target));
      }
    }

    if (partial.hal) {
      for (const [key, configKey] of HAL_CONFIG_UPDATES) {
        const value = partial.hal[key];
        if (value !== undefined) ops.push(this.adapter.update(configKey, value, target));
      }
    }

    if (partial.secrets) {
      for (const entry of SECRET_STORAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(partial.secrets, entry.key)) {
          ops.push(this.adapter.storeSecret(entry.storageKey, partial.secrets[entry.key]));
        }
      }
    }

    await Promise.all(ops);
  }
}
