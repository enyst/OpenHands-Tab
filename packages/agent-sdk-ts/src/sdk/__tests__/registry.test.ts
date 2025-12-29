import { describe, it, expect, vi } from 'vitest';
import { LLMRegistry, TrackedLLMClient } from '../llm/registry';
import { LLMFactory } from '../llm/factory';
import type { LLMClient, LLMStreamChunk } from '../llm/types';
import { Metrics } from '../llm/metrics';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}
  async *streamChat(): AsyncGenerator<LLMStreamChunk> {
    for (const c of this.chunks) yield c;
  }
}

describe('LLMRegistry and TrackedLLMClient', () => {
  it('registers, retrieves and lists usage ids', async () => {
    const registry = new LLMRegistry();
    const onUpdate = vi.fn();
    const metrics = new Metrics('m');
    const inner = new MockLLM([
      { type: 'usage', inputTokens: 3, outputTokens: 2 },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const tracked = new TrackedLLMClient({ inner, usageId: 'u1', modelName: 'm', metrics, onMetricsUpdate: onUpdate });

    registry.add(tracked);
    expect(registry.listUsageIds()).toEqual(['u1']);
    expect(registry.get('u1')).toBe(tracked);

    const chunks = [] as LLMStreamChunk[];
    for await (const ch of tracked.streamChat({ systemPrompt: '', messages: [] })) chunks.push(ch);

    expect(onUpdate).toHaveBeenCalled();
    // Verify token usage tracking (simplified metrics without arrays)
    expect(metrics.lastTokenUsage).toBeTruthy();
    expect(metrics.lastTokenUsage?.promptTokens).toBe(3);
    expect(metrics.lastTokenUsage?.completionTokens).toBe(2);
    expect(metrics.accumulatedTokenUsage?.promptTokens).toBe(3);
    expect(metrics.accumulatedTokenUsage?.completionTokens).toBe(2);
  });

  it('throws on duplicate usageId', () => {
    const registry = new LLMRegistry();
    const t1 = new TrackedLLMClient({ inner: { async *streamChat() {} }, usageId: 'dup', modelName: 'm', metrics: new Metrics('m') });
    const t2 = new TrackedLLMClient({ inner: { async *streamChat() {} }, usageId: 'dup', modelName: 'm', metrics: new Metrics('m') });
    registry.add(t1);
    expect(() => registry.add(t2)).toThrow(/already exists/);
  });

  it('can switch a usageId and updates the registry entry', async () => {
    const registry = new LLMRegistry();
    const events: string[] = [];
    registry.subscribe((e) => events.push(`${e.llm.usageId}:${e.llm.modelName}`));

    const factory1 = new LLMFactory({ model: 'gpt-5-mini', provider: 'openai', apiKey: 'sk-inline', usageId: 'default-llm' }, { registry });
    const c1 = await factory1.createClient();
    expect(registry.get('default-llm')).toBe(c1);

    const factory2 = new LLMFactory({ model: 'gpt-4o-mini', provider: 'openai', apiKey: 'sk-inline2', usageId: 'default-llm' }, { registry });
    const c2 = await factory2.createClient();
    expect(c2).not.toBe(c1);
    expect(registry.get('default-llm')).toBe(c2);

    expect(events).toEqual(['default-llm:gpt-5-mini', 'default-llm:gpt-4o-mini']);
  });

  it('registers tracked clients under provider/model registry keys', async () => {
    const registry = new LLMRegistry();
    const factory = new LLMFactory(
      { model: 'gpt-5-mini', provider: 'openai', apiKey: 'sk-inline', usageId: 'default-llm' },
      { registry },
    );
    const client = await factory.createClient();
    expect(
      registry.getByConfig({ model: 'gpt-5-mini', provider: 'openai', apiKey: 'sk-inline', usageId: 'default-llm' }),
    ).toBe(client);
  });

  it('notifies subscriber and ConversationStats can register', () => {
    const registry = new LLMRegistry();
    const events: string[] = [];
    registry.subscribe((e) => events.push(e.llm.usageId));

    const t = new TrackedLLMClient({ inner: { async *streamChat() {} }, usageId: 'x', modelName: 'm', metrics: new Metrics('m') });
    registry.add(t);
    expect(events).toEqual(['x']);
  });
});
