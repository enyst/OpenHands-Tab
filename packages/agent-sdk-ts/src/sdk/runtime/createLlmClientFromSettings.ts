import type { ApiKeyRef, LLMClient, LLMConfiguration, LLMProfileStoreOptions } from '../llm';
import { LLMFactory } from '../llm';
import type { LLMRegistry } from '../llm/registry';
import type { OpenHandsSettings } from '../types/settings';
import type { ConversationState } from './ConversationState';
import type { ConversationStats } from './ConversationStats';
import type { SecretRegistry } from './SecretRegistry';
import { isSafeProfileId, toOptionalNonEmptyString } from './settingsUtils';

export function createLlmClientFromSettings(params: {
  settings: OpenHandsSettings;
  secrets: SecretRegistry;
  profileStoreOptions?: LLMProfileStoreOptions;
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
  // Always write through so clearing settings also clears any previously registered value.
  secrets.set('openhands.llmApiKey', configuredApiKey);

  const preferredApiKeys = (() => {
    if (!profileId || !isSafeProfileId(profileId)) return undefined;
    return [`openhands.llmProfileApiKey.${profileId}`];
  })();

  const apiKeyRef = configuredApiKey
    ? ({ kind: 'key', name: 'openhands.llmApiKey' } satisfies ApiKeyRef)
    : undefined;

  const config: LLMConfiguration = {
    profileId,
    provider: s.llm.provider ?? undefined,
    model: model ?? '',
    openaiApiMode: s.llm.openaiApiMode ?? undefined,
    usageId: effectiveUsageId,
    baseUrl: s.llm.baseUrl ?? undefined,
    apiKeyRef: profileId ? undefined : apiKeyRef,
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
    profileStoreOptions: params.profileStoreOptions,
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
