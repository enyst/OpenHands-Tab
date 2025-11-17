import type { SecretStorage } from 'vscode';
import { LLMCredentialProvider } from './credentials';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './openai-compatible';
import type { ChatCompletionRequest, LLMClient, LLMConfiguration, LLMProvider } from './types';
import type { SecretRegistry } from '../runtime/SecretRegistry';

export interface LLMFactoryOptions {
  storage?: SecretStorage;
  secrets?: SecretRegistry;
  preferredApiKeys?: string | string[];
}

export class LLMFactory {
  private readonly credentialProvider: LLMCredentialProvider;
  private readonly preferredKeys?: string | string[];

  constructor(private readonly config: LLMConfiguration, options: LLMFactoryOptions = {}) {
    this.credentialProvider = new LLMCredentialProvider(options.secrets ?? options.storage);
    this.preferredKeys = options.preferredApiKeys;
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

    if (this.config.provider === 'anthropic') {
      return new AnthropicClient(this.config, apiKey);
    }

    const provider = this.config.provider ?? this.detectProviderFromBaseUrl();
    return new OpenAICompatibleClient({ ...this.config, provider }, apiKey);
  }

  requestFromDefaults(messages: ChatCompletionRequest['messages'], systemPrompt: string): ChatCompletionRequest {
    return { systemPrompt, messages };
  }

  private detectProviderFromBaseUrl(): LLMProvider {
    if (this.config.baseUrl?.includes('openrouter.ai')) return 'openrouter';
    if (this.config.baseUrl?.includes('litellm')) return 'litellm_proxy';
    return 'openai';
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
