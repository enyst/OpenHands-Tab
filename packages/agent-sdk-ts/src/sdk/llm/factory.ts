import { LLMCredentialProvider } from './credentials';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './openai-compatible';
import type { ChatCompletionRequest, LLMClient, LLMConfiguration } from './types';
import type { SecretRegistry } from '../runtime/SecretRegistry';
import { LLMRegistry, TrackedLLMClient } from './registry';
import { Metrics } from './metrics';
import { detectProviderFromBaseUrl } from './provider';

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
    const inlineApiKey =
      typeof this.config.apiKey === 'string' && !/^[A-Z0-9_]+$/.test(this.config.apiKey)
        ? this.config.apiKey
        : undefined;
    const apiKey =
      inlineApiKey ??
      (await this.credentialProvider.getApiKey(
        this.config.apiKey ?? this.preferredKeys ?? this.getDefaultApiKeyName(),
      ));
    if (!apiKey) {
      throw new Error('Missing API key for LLM provider');
    }

    const provider = this.config.provider ?? detectProviderFromBaseUrl(this.config.baseUrl);
    const base = provider === 'anthropic' ? new AnthropicClient(this.config, apiKey) : new OpenAICompatibleClient({ ...this.config, provider }, apiKey);

    if (this.config.usageId) {
      const metrics = new Metrics(this.config.model);
      const tracked = new TrackedLLMClient({ inner: base, usageId: this.config.usageId, modelName: this.config.model, metrics, onMetricsUpdate: this.onMetricsUpdate });
      this.registry?.switchLlm(tracked);
      return tracked;
    }

    return base;
  }

  requestFromDefaults(messages: ChatCompletionRequest['messages'], systemPrompt: string): ChatCompletionRequest {
    return { systemPrompt, messages };
  }

  private getDefaultApiKeyName(): string {
    switch (this.config.provider) {
      case 'openrouter':
        return 'OPENROUTER_API_KEY';
      case 'litellm_proxy':
        return 'LITELLM_API_KEY';
      case 'anthropic':
        return 'ANTHROPIC_API_KEY';
      default:
        return 'OPENAI_API_KEY';
    }
  }
}
