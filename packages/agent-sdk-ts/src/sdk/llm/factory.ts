import { createHash } from 'crypto';
import { LLMCredentialProvider } from './credentials';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './openai-compatible';
import { OpenAIResponsesClient } from './openai-responses';
import { GeminiClient } from './gemini';
import type { ChatCompletionRequest, LLMClient, LLMConfiguration, LLMProvider } from './types';
import type { SecretRegistry } from '../runtime/SecretRegistry';
import { LLMRegistry, TrackedLLMClient, llmRegistryKeyToString, toLLMRegistryKey } from './registry';
import { Metrics } from './metrics';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl } from './provider';

export interface LLMFactoryOptions {
  secrets?: SecretRegistry;
  preferredApiKeys?: string | string[];
  registry?: LLMRegistry;
  onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;
}

export class LLMFactory {
  private readonly credentialProvider: LLMCredentialProvider;
  private readonly preferredKeys?: string | string[];
  private readonly registry?: LLMRegistry;
  private readonly onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;

  constructor(private readonly config: LLMConfiguration, options: LLMFactoryOptions = {}) {
    this.credentialProvider = new LLMCredentialProvider(options.secrets);
    this.preferredKeys = options.preferredApiKeys;
    this.registry = options.registry;
    this.onMetricsUpdate = options.onMetricsUpdate;
  }

  async createClient(): Promise<LLMClient> {
    const normalizeOptionalString = (value: unknown): string | undefined => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed.length ? trimmed : undefined;
    };
    const hashString = (input: string): string => createHash('sha256').update(input).digest('hex');
      const stableStringifyHeaders = (headers: Record<string, string> | undefined): string | undefined => {
        if (!headers) return undefined;
        const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
        return JSON.stringify(Object.fromEntries(entries));
      };

      const provider = this.config.provider ?? detectProviderFromBaseUrl(this.config.baseUrl);

      const inlineApiKey =
        typeof this.config.apiKey === 'string' && !/^[A-Z0-9_]+$/.test(this.config.apiKey)
          ? this.config.apiKey
          : undefined;
      const apiKey =
        inlineApiKey ??
        (await this.credentialProvider.getApiKey(
          this.config.apiKey ?? this.preferredKeys ?? this.getDefaultApiKeyName(provider),
        ));
      if (!apiKey) {
        throw new Error('Missing API key for LLM provider');
      }

      const normalizedModel = this.config.model.toLowerCase();
      const openaiApiMode = provider === 'openai' ? this.config.openaiApiMode ?? undefined : undefined;
      const normalizeUrl = (value: string | null | undefined): string | undefined => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (!trimmed) return undefined;
      return trimmed.replace(/\/+$/, '');
    };
    const normalizedBaseUrl = normalizeUrl(this.config.baseUrl);
    const normalizedDefaultOpenAIBaseUrl = normalizeUrl(DEFAULT_PROVIDER_BASE_URLS.openai);
    const baseUrlSupportsResponses = !normalizedBaseUrl || normalizedBaseUrl === normalizedDefaultOpenAIBaseUrl;
    const isGpt5 = normalizedModel.startsWith('gpt-5');
    const useResponses = provider === 'openai'
      && isGpt5
      && (openaiApiMode === 'responses' || (openaiApiMode !== 'chat_completions' && baseUrlSupportsResponses));
    const effectiveOpenaiApiMode = provider === 'openai' ? (useResponses ? 'responses' : 'chat_completions') : undefined;
    const registryKey = toLLMRegistryKey({ ...this.config, provider, openaiApiMode: effectiveOpenaiApiMode });

    const explicitUsageId = normalizeOptionalString(this.config.usageId);
    const derivedUsageId = (() => {
      if (explicitUsageId) return explicitUsageId;
      if (!this.registry) return undefined;
      const fingerprint = {
        key: llmRegistryKeyToString(registryKey),
        timeoutSeconds: this.config.timeoutSeconds ?? null,
        temperature: this.config.temperature ?? null,
        topP: this.config.topP ?? null,
        topK: this.config.topK ?? null,
        maxInputTokens: this.config.maxInputTokens ?? null,
        maxOutputTokens: this.config.maxOutputTokens ?? null,
        reasoningEffort: this.config.reasoningEffort ?? null,
        reasoningSummary: this.config.reasoningSummary ?? null,
        headers: stableStringifyHeaders(this.config.headers),
        inputCostPerToken: this.config.inputCostPerToken ?? null,
        outputCostPerToken: this.config.outputCostPerToken ?? null,
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
      base = new AnthropicClient(this.config, apiKey);
    } else if (provider === 'gemini') {
      base = new GeminiClient({ ...this.config, provider }, apiKey);
    } else if (useResponses) {
      base = new OpenAIResponsesClient({ ...this.config, provider }, apiKey);
    } else {
      base = new OpenAICompatibleClient({ ...this.config, provider }, apiKey);
    }

    if (derivedUsageId) {
      const metrics = new Metrics(this.config.model);
      const tracked = new TrackedLLMClient({ inner: base, usageId: derivedUsageId, modelName: this.config.model, metrics, onMetricsUpdate: this.onMetricsUpdate });
      this.registry?.switchLlm(tracked, registryKey);
      return tracked;
    }

    return base;
  }

    requestFromDefaults(messages: ChatCompletionRequest['messages'], systemPrompt: string): ChatCompletionRequest {
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
