import type { SettingsAdapter, LLMSettings, ServerSettings, AgentSettings, ConversationSettings, ConfirmationSettings } from './SettingsAdapter';
import type { HalMode } from '../shared/halTypes';
import { normalizeServerUrl } from '../shared/serverUrls';
import { detectProviderFromBaseUrl, ensureDefaultProfiles, loadProfile } from '@openhands/agent-sdk-ts';

export interface SavedServer {
  url: string;
  label?: string;
}

export type HalSettings = {
  enabled: boolean;
  mode: HalMode;
  userName: string;
  voiceAId?: string;
  voiceUserId?: string;
  modelId?: string;
  volume: number;
  cache: boolean;
};

export type GeminiSettings = {
  model: string;
  baseUrl: string;
};

export type OpenHandsSettings = ServerSettings & {
  llm: LLMSettings;
  agent: AgentSettings;
  conversation: ConversationSettings;
  confirmation: ConfirmationSettings;
  hal: HalSettings;
  gemini: GeminiSettings;
  servers: SavedServer[];
  secrets: {
    sessionApiKey?: string;
    llmApiKey?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    githubToken?: string;
    elevenLabsApiKey?: string;
    customSecret1?: string;
    customSecret2?: string;
    customSecret3?: string;
  };
};

const DEFAULTS: OpenHandsSettings = {
  serverUrl: '',
  servers: [],
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  agent: { enableSecurityAnalyzer: true, debug: false, summarizeToolCalls: false },
  conversation: { maxIterations: 50 },
  confirmation: { policy: 'never', riskyThreshold: 'MEDIUM', confirmUnknown: true },
  hal: { enabled: false, mode: 'tts_only', userName: 'Engel', volume: 1, cache: true },
  gemini: { model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
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
  ['userName', 'openhands.hal.userName'],
  ['voiceAId', 'openhands.hal.voiceAId'],
  ['voiceUserId', 'openhands.hal.voiceUserId'],
  ['modelId', 'openhands.hal.modelId'],
  ['volume', 'openhands.hal.volume'],
  ['cache', 'openhands.hal.cache'],
];

const normalizeNonEmptyString = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

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

    for (const entry of DEFAULT_LLM_PROFILE_ID_BY_API_KEY) {
      if (await hasSecret(entry.secretKey)) return entry.profileId;
    }

    return DEFAULT_LLM_PROFILE_ID;
  }

  drainServerNormalizationWarnings(): string[] {
    const warnings = this.serverNormalizationWarnings;
    this.serverNormalizationWarnings = [];
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
    }

    const usageId = normalizeNonEmptyString(this.adapter.getExplicit<string>('openhands.llm.usageId'));
    const configuredProfileId = normalizeNonEmptyString(this.adapter.getExplicit<string>('openhands.llm.profileId'));
    const profileId = configuredProfileId && isSafeProfileId(configuredProfileId)
      ? configuredProfileId
      : undefined;
    let effectiveProfileId = profileId;
    if (!profileId) {
      try {
        const selected = await this.pickDefaultProfileId();
        effectiveProfileId = selected;
        await this.update({ llm: { profileId: selected } }, 'global');
      } catch {
        // Best-effort: still return the computed id even if persistence fails.
      }
    }
    if (!effectiveProfileId) {
      effectiveProfileId = await this.pickDefaultProfileId();
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
      usageId,
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
    const gemini: GeminiSettings = {
      model: normalizeNonEmptyString(
        this.adapter.get<string | null>('openhands.hal.gemini.model', DEFAULTS.gemini.model) ?? DEFAULTS.gemini.model
      ) ?? DEFAULTS.gemini.model,
      baseUrl: normalizeNonEmptyString(
        this.adapter.get<string | null>('openhands.hal.gemini.baseUrl', DEFAULTS.gemini.baseUrl) ?? DEFAULTS.gemini.baseUrl
      ) ?? DEFAULTS.gemini.baseUrl,
    };
    const secrets = {
      sessionApiKey: await this.adapter.getSecret('openhands.sessionApiKey'),
      llmApiKey: await this.adapter.getSecret('openhands.llmApiKey'),
      awsAccessKeyId: await this.adapter.getSecret('openhands.awsAccessKeyId'),
      awsSecretAccessKey: await this.adapter.getSecret('openhands.awsSecretAccessKey'),
      githubToken: await this.adapter.getSecret('openhands.githubToken'),
      elevenLabsApiKey: await this.adapter.getSecret('openhands.elevenLabsApiKey'),

      customSecret1: await this.adapter.getSecret('openhands.customSecret1'),
      customSecret2: await this.adapter.getSecret('openhands.customSecret2'),
      customSecret3: await this.adapter.getSecret('openhands.customSecret3'),
    };
    return { serverUrl, servers, llm, agent, conversation, confirmation, hal, gemini, secrets };
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
      if (partial.llm.usageId !== undefined) ops.push(this.adapter.update('openhands.llm.usageId', partial.llm.usageId, target));
      if (partial.llm.profileId !== undefined) ops.push(this.adapter.update('openhands.llm.profileId', partial.llm.profileId, target));
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

    if (partial.gemini) {
      if (partial.gemini.model !== undefined) {
        ops.push(this.adapter.update('openhands.hal.gemini.model', partial.gemini.model, target));
      }
      if (partial.gemini.baseUrl !== undefined) {
        ops.push(this.adapter.update('openhands.hal.gemini.baseUrl', partial.gemini.baseUrl, target));
      }
    }

    if (partial.secrets) {
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'sessionApiKey')) {
        ops.push(this.adapter.storeSecret('openhands.sessionApiKey', partial.secrets.sessionApiKey));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'llmApiKey')) {
        ops.push(this.adapter.storeSecret('openhands.llmApiKey', partial.secrets.llmApiKey));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsAccessKeyId')) {
        ops.push(this.adapter.storeSecret('openhands.awsAccessKeyId', partial.secrets.awsAccessKeyId));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'awsSecretAccessKey')) {
        ops.push(this.adapter.storeSecret('openhands.awsSecretAccessKey', partial.secrets.awsSecretAccessKey));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'githubToken')) {
        ops.push(this.adapter.storeSecret('openhands.githubToken', partial.secrets.githubToken));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'elevenLabsApiKey')) {
        ops.push(this.adapter.storeSecret('openhands.elevenLabsApiKey', partial.secrets.elevenLabsApiKey));
      }

      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'customSecret1')) {
        ops.push(this.adapter.storeSecret('openhands.customSecret1', partial.secrets.customSecret1));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'customSecret2')) {
        ops.push(this.adapter.storeSecret('openhands.customSecret2', partial.secrets.customSecret2));
      }
      if (Object.prototype.hasOwnProperty.call(partial.secrets, 'customSecret3')) {
        ops.push(this.adapter.storeSecret('openhands.customSecret3', partial.secrets.customSecret3));
      }
    }

    await Promise.all(ops);
  }
}
