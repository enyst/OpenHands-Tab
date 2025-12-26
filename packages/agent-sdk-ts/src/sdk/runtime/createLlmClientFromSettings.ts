import type { LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import type { LLMRegistry } from '../llm/registry';
import type { OpenHandsSettings } from '../types/settings';
import type { ConversationState } from './ConversationState';
import type { ConversationStats } from './ConversationStats';
import type { SecretRegistry } from './SecretRegistry';

const toOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const isSafeProfileId = (profileId: string): boolean => {
  if (!profileId.trim()) return false;
  if (profileId !== profileId.trim()) return false;
  if (profileId.includes('/') || profileId.includes('\\')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(profileId);
};

export function createLlmClientFromSettings(params: {
  settings: OpenHandsSettings;
  secrets: SecretRegistry;
  registry?: LLMRegistry;
  conversationStats?: ConversationStats;
  state: ConversationState;
}): Promise<LLMClient> {
  const { settings: s, secrets, registry, conversationStats, state } = params;

  const profileId = toOptionalNonEmptyString(s.llm?.profileId);
  const model = toOptionalNonEmptyString(s.llm?.model);
  if (!profileId && !model) {
    return Promise.reject(new Error('LLM model is not configured'));
  }

  const effectiveUsageId = 'agent';

  const configuredApiKey = toOptionalNonEmptyString(s.secrets?.llmApiKey);
  const configuredApiKeyIsReference =
    typeof configuredApiKey === 'string' && /^[A-Z0-9_]+$/.test(configuredApiKey);
  const configuredApiKeyInline = configuredApiKeyIsReference ? undefined : configuredApiKey;
  secrets.set('openhands.llmApiKey', configuredApiKeyInline);

  const preferredApiKeys = (() => {
    if (!profileId || !isSafeProfileId(profileId)) return undefined;
    const keys: string[] = [`openhands.llmProfileApiKey.${profileId}`];
    if (configuredApiKeyIsReference && configuredApiKey) {
      keys.push(configuredApiKey);
    }
    return keys;
  })();

  const config = {
    profileId,
    provider: s.llm.provider ?? undefined,
    model: model ?? '',
    openaiApiMode: s.llm.openaiApiMode ?? undefined,
    usageId: effectiveUsageId,
    baseUrl: s.llm.baseUrl ?? undefined,
    apiKey: profileId ? undefined : configuredApiKey,
    apiVersion: s.llm.apiVersion ?? undefined,
    timeoutSeconds: s.llm.timeout ?? undefined,
    temperature: s.llm.temperature ?? undefined,
    topP: s.llm.topP ?? undefined,
    topK: s.llm.topK ?? undefined,
    maxInputTokens: s.llm.maxInputTokens ?? undefined,
    maxOutputTokens: s.llm.maxOutputTokens ?? undefined,
    reasoningEffort: s.llm.reasoningEffort ?? undefined,
    reasoningSummary: s.llm.reasoningSummary ?? undefined,
    inputCostPerToken: s.llm.inputCostPerToken ?? undefined,
    outputCostPerToken: s.llm.outputCostPerToken ?? undefined,
  };

  const factory = new LLMFactory(config, {
    secrets,
    preferredApiKeys,
    registry,
    onMetricsUpdate: (usageId, metrics) => {
      if (!conversationStats) return;
      if (!conversationStats.usageToMetrics[usageId]) {
        conversationStats.usageToMetrics[usageId] = metrics;
      }
      state.setValue('stats', conversationStats.toJSON());
    },
  });

  return factory.createClient();
}

