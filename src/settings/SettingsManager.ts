import type { SettingsAdapter } from './SettingsAdapter';
import type { HalSettings, OpenHandsSettings } from '../shared/settingsTypes';
import { DEFAULT_HAL_LLM_PROFILE_ID } from '../shared/halDefaults';
import { normalizeNonEmptyString } from '../shared/stringUtils';
import type { AgentSettings, ConfirmationSettings, ConversationSettings, LLMSettings } from '@openhands/agent-sdk-ts';
import { detectProviderFromBaseUrl } from '@openhands/agent-sdk-ts';
import { loadSelectedProfileConfig, pickDefaultProfileId } from './settingsProfileDefaults';
import {
  clampUnitInterval,
  isSafeProfileId,
  normalizeHalMode,
  normalizeOracleProfileId,
  normalizeServerSettings,
  sanitizePositiveInteger,
} from './settingsNormalization';

export type { HalSettings, OpenHandsSettings, SavedServer } from '../shared/settingsTypes';

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

const OPENHANDS_SECRET_KEYS: Array<keyof OpenHandsSettings['secrets']> = [
  'cloudApiKey',
  'runtimeSessionApiKey',
  'llmApiKey',
  'awsAccessKeyId',
  'awsSecretAccessKey',
  'githubToken',
  'halTtsApiKey',
  'customSecret1',
  'customSecret2',
  'customSecret3',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOpenHandsSettingsSecrets = (value: unknown): value is OpenHandsSettings['secrets'] => {
  if (!isRecord(value)) return false;
  for (const key of OPENHANDS_SECRET_KEYS) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== 'string') return false;
  }
  return true;
};

export const isOpenHandsSettings = (value: unknown): value is OpenHandsSettings => {
  if (!isRecord(value)) return false;
  if (!isRecord(value.llm)) return false;
  if (!isRecord(value.agent)) return false;
  if (!isRecord(value.conversation)) return false;
  if (!isRecord(value.confirmation)) return false;
  if (!isRecord(value.hal)) return false;
  if (!Array.isArray(value.servers)) return false;
  return isOpenHandsSettingsSecrets(value.secrets);
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
    return pickDefaultProfileId(this.llmProfileStoreRoot, hasSecret);
  }

  drainServerNormalizationWarnings(): string[] {
    const warnings = [...this.serverNormalizationWarnings, ...this.validationWarnings];
    this.serverNormalizationWarnings = [];
    this.validationWarnings = [];
    return warnings;
  }

  async get(): Promise<OpenHandsSettings> {
    const rawServerUrl = this.adapter.get<string | null>('openhands.serverUrl', DEFAULTS.serverUrl) ?? DEFAULTS.serverUrl;
    const rawServers = this.adapter.get<unknown>('openhands.servers', DEFAULTS.servers) ?? DEFAULTS.servers;
    const normalizedServerSettings = normalizeServerSettings(rawServerUrl, rawServers, DEFAULTS.servers);
    const { serverUrl, servers } = normalizedServerSettings;

    if (normalizedServerSettings.changed) {
      this.serverNormalizationWarnings = normalizedServerSettings.warnings;
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

    const profileConfig = loadSelectedProfileConfig(effectiveProfileId, this.llmProfileStoreRoot);
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

    const explicitOracleProfileId = this.adapter.getExplicit<unknown>('openhands.oracle.profileId');
    const rawOracleProfileId = explicitOracleProfileId === undefined
      ? this.adapter.get<unknown>('openhands.oracle.profileId', DEFAULTS.oracle?.profileId ?? null)
      : explicitOracleProfileId;
    const oracleResult = normalizeOracleProfileId(rawOracleProfileId, explicitOracleProfileId === null);
    this.validationWarnings = oracleResult.warnings;
    const oracle = { profileId: oracleResult.profileId };
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
