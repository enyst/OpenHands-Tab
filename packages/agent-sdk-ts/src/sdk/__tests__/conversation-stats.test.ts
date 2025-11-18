import { describe, it, expect } from 'vitest';
import { ConversationStats } from '../runtime/ConversationStats';
import { Metrics } from '../llm/metrics';

function makeMetrics(token: number): Metrics {
  const m = new Metrics('m');
  m.addTokenUsage({ promptTokens: token, completionTokens: token, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: String(token) });
  return m;
}

describe('ConversationStats', () => {
  it('registers llm metrics and combines', () => {
    const stats = new ConversationStats();
    const llmA = { llm: { usageId: 'a', metrics: makeMetrics(1) } };
    const llmB = { llm: { usageId: 'b', metrics: makeMetrics(2) } };

    stats.register_llm(llmA);
    stats.register_llm(llmB);

    expect(Object.keys(stats.usage_to_metrics)).toEqual(['a', 'b']);

    const combined = stats.get_combined_metrics().getSnapshot();
    expect(combined.accumulatedTokenUsage?.promptTokens).toBe(3);
  });

  it('serializes and restores from JSON', () => {
    const stats = new ConversationStats();
    stats.register_llm({ llm: { usageId: 'a', metrics: makeMetrics(3) } });

    const json = stats.toJSON();
    const restored = ConversationStats.fromJSON(json);

    const m = restored.get_metrics_for_usage('a');
    expect(m.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(3);
  });
});
