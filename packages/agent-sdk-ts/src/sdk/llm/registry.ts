import type { LLMClient } from './types';
import type { LLMConfiguration, LLMProvider, OpenAIChatApi } from './types';
import type { Metrics } from './metrics';
import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl } from './provider';

export type RegistryEvent = { llm: TrackedLLMClient };

export type LLMRegistryKey = {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  openaiApiMode?: OpenAIChatApi;
  apiVersion?: string;
};

const normalizeUrl = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
};

export const toLLMRegistryKey = (config: LLMConfiguration): LLMRegistryKey => {
  const provider = config.provider ?? detectProviderFromBaseUrl(config.baseUrl);
  const effectiveBaseUrl = normalizeUrl(config.baseUrl) ?? normalizeUrl(DEFAULT_PROVIDER_BASE_URLS[provider]);
  const normalizedModel = config.model.toLowerCase();
  const configuredOpenaiApiMode = provider === 'openai' ? (config.openaiApiMode ?? undefined) : undefined;
  const normalizedConfiguredBaseUrl = normalizeUrl(config.baseUrl);
  const normalizedDefaultOpenAIBaseUrl = normalizeUrl(DEFAULT_PROVIDER_BASE_URLS.openai);
  const baseUrlSupportsResponses = !normalizedConfiguredBaseUrl || normalizedConfiguredBaseUrl === normalizedDefaultOpenAIBaseUrl;
  const useResponses = provider === 'openai'
    && normalizedModel.startsWith('gpt-5')
    && (configuredOpenaiApiMode === 'responses' || (configuredOpenaiApiMode !== 'chat_completions' && baseUrlSupportsResponses));
  const effectiveOpenaiApiMode = provider === 'openai' ? (useResponses ? 'responses' : 'chat_completions') : undefined;
  return {
    provider,
    model: config.model,
    baseUrl: effectiveBaseUrl,
    openaiApiMode: effectiveOpenaiApiMode,
    apiVersion: normalizeUrl(config.apiVersion),
  };
};

export const llmRegistryKeyToString = (key: LLMRegistryKey): string => {
  const baseUrl = key.baseUrl ?? '';
  const apiVersion = key.apiVersion ?? '';
  const openaiApiMode = key.provider === 'openai' ? (key.openaiApiMode ?? '') : '';
  return `${key.provider}|${key.model}|${baseUrl}|${openaiApiMode}|${apiVersion}`;
};

export class LLMRegistry {
  readonly registryId: string;
  private usageToLLM = new Map<string, TrackedLLMClient>();
  private keyToLLM = new Map<string, TrackedLLMClient>();
  private subscriber?: (event: RegistryEvent) => void;

  constructor() {
    this.registryId = Math.random().toString(36).slice(2);
  }

  subscribe(cb: (event: RegistryEvent) => void): void {
    this.subscriber = cb;
  }

  notify(event: RegistryEvent): void {
    try { this.subscriber?.(event); } catch { /* noop */ }
  }

  add(llm: TrackedLLMClient): void {
    const id = llm.usageId;
    if (this.usageToLLM.has(id)) throw new Error(`Usage ID '${id}' already exists in registry`);
    this.switchLlm(llm);
  }

  switchLlm(llm: TrackedLLMClient, key?: LLMRegistryKey): void {
    const id = llm.usageId;
    this.usageToLLM.set(id, llm);
    if (key) {
      this.keyToLLM.set(llmRegistryKeyToString(key), llm);
    }
    this.notify({ llm });
  }

  get(usageId: string): TrackedLLMClient {
    const llm = this.usageToLLM.get(usageId);
    if (!llm) throw new Error(`Usage ID '${usageId}' not found in registry`);
    return llm;
  }

  getByKey(key: LLMRegistryKey): TrackedLLMClient {
    const encoded = llmRegistryKeyToString(key);
    const llm = this.keyToLLM.get(encoded);
    if (!llm) throw new Error(`LLM key '${encoded}' not found in registry`);
    return llm;
  }

  getByConfig(config: LLMConfiguration): TrackedLLMClient {
    return this.getByKey(toLLMRegistryKey(config));
  }

  listUsageIds(): string[] { return Array.from(this.usageToLLM.keys()); }

  clear(): void {
    this.usageToLLM.clear();
    this.keyToLLM.clear();
  }
}

export class TrackedLLMClient implements LLMClient {
  readonly inner: LLMClient;
  readonly usageId: string;
  readonly modelName: string;
  readonly metrics: Metrics;
  private onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;

  constructor(params: {
    inner: LLMClient;
    usageId: string;
    modelName: string;
    metrics: Metrics;
    onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;
  }) {
    this.inner = params.inner;
    this.usageId = params.usageId;
    this.modelName = params.modelName;
    this.metrics = params.metrics;
    this.onMetricsUpdate = params.onMetricsUpdate;
  }

  setOnMetricsUpdate(cb?: (usageId: string, metrics: Metrics) => void): void {
    this.onMetricsUpdate = cb;
  }

  async *streamChat(request: import('./types').ChatCompletionRequest): AsyncGenerator<import('./types').LLMStreamChunk> {
    const start = Date.now();
    const responseId = `${this.usageId}-${start}`;
    try {
      for await (const chunk of this.inner.streamChat(request)) {
        if (chunk.type === 'usage') {
          this.metrics.addTokenUsage({
            promptTokens: chunk.inputTokens ?? 0,
            completionTokens: chunk.outputTokens ?? 0,
            cacheReadTokens: chunk.cacheReadTokens ?? 0,
            cacheWriteTokens: chunk.cacheWriteTokens ?? 0,
            contextWindow: 0,
            responseId,
          });
          this.onMetricsUpdate?.(this.usageId, this.metrics);
        }
        if (chunk.type === 'finish') {
          const seconds = (Date.now() - start) / 1000;
          this.metrics.addResponseLatency(seconds, responseId);
          this.onMetricsUpdate?.(this.usageId, this.metrics);
        }
        yield chunk;
      }
    } finally {
      // no-op
    }
  }
}
