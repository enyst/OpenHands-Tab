import { describe, it, expect, vi } from 'vitest';
import { LLMRegistry, TrackedLLMClient } from '../llm/registry';
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
    const json = metrics.toJSON();
    expect((json.responseLatencies as unknown[]).length).toBe(1);
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
