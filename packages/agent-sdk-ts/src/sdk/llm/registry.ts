import type { LLMClient } from './types';
import type { Metrics } from './metrics';

export type RegistryEvent = { llm: TrackedLLMClient };

export class LLMRegistry {
  readonly registryId: string;
  private usageToLLM = new Map<string, TrackedLLMClient>();
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
    this.upsert(llm);
  }

  upsert(llm: TrackedLLMClient): void {
    const id = llm.usageId;
    this.usageToLLM.set(id, llm);
    this.notify({ llm });
  }

  get(usageId: string): TrackedLLMClient {
    const llm = this.usageToLLM.get(usageId);
    if (!llm) throw new Error(`Usage ID '${usageId}' not found in registry`);
    return llm;
  }

  listUsageIds(): string[] { return Array.from(this.usageToLLM.keys()); }
}

export class TrackedLLMClient implements LLMClient {
  readonly inner: LLMClient;
  readonly usageId: string;
  readonly modelName: string;
  readonly metrics: Metrics;
  private readonly onMetricsUpdate?: (usageId: string, metrics: Metrics) => void;

  constructor(params: { inner: LLMClient; usageId: string; modelName: string; metrics: Metrics; onMetricsUpdate?: (usageId: string, metrics: Metrics) => void }) {
    this.inner = params.inner;
    this.usageId = params.usageId;
    this.modelName = params.modelName;
    this.metrics = params.metrics;
    this.onMetricsUpdate = params.onMetricsUpdate;
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
