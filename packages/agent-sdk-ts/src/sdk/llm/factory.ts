import { createHash } from 'crypto';
import { LLMCredentialProvider } from './credentials';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './openai-compatible';
import { OpenAIResponsesClient } from './openai-responses';
import { GeminiClient } from './gemini';
import type { ApiKeyRef, ChatCompletionRequest, LLMClient, LLMConfiguration, LLMProvider } from './types';
import type { LLMProfileStoreOptions } from './profiles';
import { loadProfile } from './profiles';
import { normalizeGenerationParamsForModel } from './providerQuirks';
import type { SecretRegistry } from '../runtime/SecretRegistry';
import { LLMRegistry, TrackedLLMClient, llmRegistryKeyToString, toLLMRegistryKey } from './registry';
import { Metrics } from './metrics';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl } from './provider';
import { lookupModelsDevTokenPricing } from './modelsDevPricing';

export interface LLMFactoryOptions {
  secrets?: SecretRegistry;
  preferredApiKeys?: string | string[];
  profileStoreOptions?: LLMProfileStoreOptions;
  registry?: LLMRegistry;
  onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;
}

export class LLMFactory {
  private readonly credentialProvider: LLMCredentialProvider;
  private readonly preferredKeys?: string | string[];
  private readonly profileStoreOptions?: LLMProfileStoreOptions;
  private readonly registry?: LLMRegistry;
  private readonly onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;

  constructor(private readonly config: LLMConfiguration, options: LLMFactoryOptions = {}) {
    this.credentialProvider = new LLMCredentialProvider(options.secrets);
    this.preferredKeys = options.preferredApiKeys;
    this.profileStoreOptions = options.profileStoreOptions;
    this.registry = options.registry;
    this.onMetricsUpdate = options.onMetricsUpdate;
  }

  async createClient(): Promise<LLMClient> {
    const normalizeOptionalString = (value: unknown): string | undefined => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed.length ? trimmed : undefined;
    };
    const normalizeApiKeyRef = (value: unknown): ApiKeyRef | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      const kind = (value as { kind?: unknown }).kind;
      if (kind === 'inline') {
        const inline = normalizeOptionalString((value as { value?: unknown }).value);
        return inline ? { kind: 'inline', value: inline } : undefined;
      }
      if (kind === 'key') {
        const name = normalizeOptionalString((value as { name?: unknown }).name);
        return name ? { kind: 'key', name } : undefined;
      }
      return undefined;
    };
    const hashString = (input: string): string => createHash('sha256').update(input).digest('hex');
    const stableStringifyHeaders = (headers: Record<string, string> | undefined): string | undefined => {
      if (!headers) return undefined;
      const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify(Object.fromEntries(entries));
    };

    const profileId = normalizeOptionalString(this.config.profileId);
    let config: LLMConfiguration = (() => {
      if (!profileId) return this.config;
      const profile = loadProfile(profileId, this.profileStoreOptions);
      const merged: LLMConfiguration = {
        ...profile.config,
        profileId,
      };

      // Profiles-first: when `profileId` is set, treat the profile config as the single source
      // of truth for provider/model/baseUrl/generation config. Only allow a small override
      // set for runtime bookkeeping/secrets.
      const requestedUsageId = normalizeOptionalString(this.config.usageId);
      if (requestedUsageId) merged.usageId = requestedUsageId;
      const requestedApiKeyRef = normalizeApiKeyRef(this.config.apiKeyRef);
      if (requestedApiKeyRef) merged.apiKeyRef = requestedApiKeyRef;
      return merged;
    })();
    config = normalizeGenerationParamsForModel(config);

    const normalizeUrl = (value: string | null | undefined): string | undefined => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) return undefined;
      return trimmed.replace(/\/+$/, '');
    };

    const provider = config.provider ?? detectProviderFromBaseUrl(config.baseUrl);

    const needsPricing = (
      config.inputCostPerToken === null || config.inputCostPerToken === undefined
      || config.outputCostPerToken === null || config.outputCostPerToken === undefined
      || config.cacheReadCostPerToken === null || config.cacheReadCostPerToken === undefined
      || config.cacheWriteCostPerToken === null || config.cacheWriteCostPerToken === undefined
    );

    if (needsPricing) {
      const normalizedBaseUrl = normalizeUrl(config.baseUrl);
      const normalizedDefaultBaseUrl = normalizeUrl(DEFAULT_PROVIDER_BASE_URLS[provider]);
      const baseUrlMatchesProviderDefault =
        !normalizedBaseUrl || normalizedBaseUrl === normalizedDefaultBaseUrl;

      if (baseUrlMatchesProviderDefault) {
        try {
          const pricing = await lookupModelsDevTokenPricing({ provider, model: config.model });
          if (pricing) {
            config = {
              ...config,
              inputCostPerToken: config.inputCostPerToken ?? pricing.inputCostPerToken,
              cacheReadCostPerToken: config.cacheReadCostPerToken ?? pricing.cacheReadCostPerToken,
              cacheWriteCostPerToken: config.cacheWriteCostPerToken ?? pricing.cacheWriteCostPerToken,
              outputCostPerToken: config.outputCostPerToken ?? pricing.outputCostPerToken,
            };
          }
        } catch {
          // Best-effort only: ignore pricing lookup errors.
        }
      }
    }

    const normalizedApiKeyRef = normalizeApiKeyRef(config.apiKeyRef);
    const inlineApiKey = normalizedApiKeyRef?.kind === 'inline' ? normalizedApiKeyRef.value : undefined;
    const preferredApiKeyName = normalizedApiKeyRef?.kind === 'key' ? normalizedApiKeyRef.name : undefined;
    const defaultApiKeyName = this.getDefaultApiKeyName(provider);
    const preferredApiKeys = preferredApiKeyName ?? this.preferredKeys;
    const apiKeyLookup = (() => {
      const llmGlobalKey = 'openhands.llmApiKey';
      if (Array.isArray(preferredApiKeys)) {
        const keys = [...preferredApiKeys];
        if (!keys.includes(defaultApiKeyName)) keys.push(defaultApiKeyName);
        if (!keys.includes(llmGlobalKey)) keys.push(llmGlobalKey);
        return keys;
      }
      if (typeof preferredApiKeys === 'string' && preferredApiKeys.trim()) {
        const keys = [preferredApiKeys];
        if (!keys.includes(defaultApiKeyName)) keys.push(defaultApiKeyName);
        if (!keys.includes(llmGlobalKey)) keys.push(llmGlobalKey);
        return keys;
      }
      return [defaultApiKeyName, llmGlobalKey];
    })();
    const apiKey =
      inlineApiKey ??
      (await this.credentialProvider.getApiKey(apiKeyLookup));
    if (!apiKey) {
      throw new Error('Missing API key for LLM provider');
    }

    const normalizedModel = config.model.toLowerCase();
    const openaiApiMode = provider === 'openai' ? config.openaiApiMode ?? undefined : undefined;
    const normalizedBaseUrl = normalizeUrl(config.baseUrl);
    const normalizedDefaultOpenAIBaseUrl = normalizeUrl(DEFAULT_PROVIDER_BASE_URLS.openai);
    const baseUrlSupportsResponses = !normalizedBaseUrl || normalizedBaseUrl === normalizedDefaultOpenAIBaseUrl;
    const isGpt5 = normalizedModel.startsWith('gpt-5');
    const useResponses =
      provider === 'openai' &&
      isGpt5 &&
      (openaiApiMode === 'responses' ||
        (openaiApiMode !== 'chat_completions' && baseUrlSupportsResponses));
    const effectiveOpenaiApiMode =
      provider === 'openai' ? (useResponses ? 'responses' : 'chat_completions') : undefined;
    const registryKey = toLLMRegistryKey({
      ...config,
      provider,
      openaiApiMode: effectiveOpenaiApiMode,
    });

    const explicitUsageId = normalizeOptionalString(config.usageId);
    const derivedUsageId = (() => {
      if (explicitUsageId) return explicitUsageId;
      if (!this.registry) return undefined;
      const fingerprint = {
        key: llmRegistryKeyToString(registryKey),
        timeoutSeconds: config.timeoutSeconds ?? null,
        temperature: config.temperature ?? null,
        topP: config.topP ?? null,
        topK: config.topK ?? null,
        maxInputTokens: config.maxInputTokens ?? null,
        maxOutputTokens: config.maxOutputTokens ?? null,
        reasoningEffort: config.reasoningEffort ?? null,
        reasoningSummary: config.reasoningSummary ?? null,
        headers: stableStringifyHeaders(config.headers),
        inputCostPerToken: config.inputCostPerToken ?? null,
        outputCostPerToken: config.outputCostPerToken ?? null,
        apiKeyHash: hashString(apiKey).slice(0, 16),
      };
      const digest = hashString(JSON.stringify(fingerprint)).slice(0, 12);
      return `${registryKey.provider}:${registryKey.model}:${digest}`;
    })();

    if (derivedUsageId && !explicitUsageId && this.registry) {
      try {
        const cached = this.registry.get(derivedUsageId);
        cached.setOnMetricsUpdate(this.onMetricsUpdate);
        // Re-announce selection so stats/UI have a consistent "current llm" signal.
        this.registry.switchLlm(cached, registryKey);
        return cached;
      } catch {
        // Cache miss; create a fresh client.
      }
    }
    let base: LLMClient;
    if (provider === 'anthropic') {
      base = new AnthropicClient(config, apiKey);
    } else if (provider === 'gemini') {
      base = new GeminiClient({ ...config, provider }, apiKey);
    } else if (useResponses) {
      base = new OpenAIResponsesClient({ ...config, provider }, apiKey);
    } else {
      base = new OpenAICompatibleClient({ ...config, provider }, apiKey);
    }

    if (derivedUsageId) {
      const metrics = new Metrics(config.model, {
        inputCostPerToken: config.inputCostPerToken ?? null,
        cacheReadCostPerToken: config.cacheReadCostPerToken ?? null,
        cacheWriteCostPerToken: config.cacheWriteCostPerToken ?? null,
        outputCostPerToken: config.outputCostPerToken ?? null,
      });
      const tracked = new TrackedLLMClient({
        inner: base,
        usageId: derivedUsageId,
        modelName: config.model,
        metrics,
        onMetricsUpdate: this.onMetricsUpdate,
      });
      this.registry?.switchLlm(tracked, registryKey);
      return tracked;
    }

    return base;
  }

  requestFromDefaults(
    messages: ChatCompletionRequest['messages'],
    systemPrompt: string,
  ): ChatCompletionRequest {
    return { systemPrompt, messages };
  }

  private getDefaultApiKeyName(provider: LLMProvider): string {
    switch (provider) {
      case 'openrouter':
        return 'OPENROUTER_API_KEY';
      case 'litellm_proxy':
        return 'LITELLM_API_KEY';
      case 'anthropic':
        return 'ANTHROPIC_API_KEY';
      case 'gemini':
        return 'GEMINI_API_KEY';
      default:
        return 'OPENAI_API_KEY';
    }
  }
}
