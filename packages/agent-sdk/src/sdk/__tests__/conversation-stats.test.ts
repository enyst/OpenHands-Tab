import { describe, it, expect } from 'vitest';
import { ConversationStats } from '../runtime/ConversationStats';
import { Metrics } from '../llm/metrics';

function makeMetrics(token: number): Metrics {
  const m = new Metrics('m');
  m.addTokenUsage({ promptTokens: token, completionTokens: token, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: String(token) });
  return m;
}

function makePricedMetrics(params: {
  promptTokens: number;
  completionTokens: number;
  inputCostPerToken: number;
  outputCostPerToken: number;
}): Metrics {
  const m = new Metrics('m', { inputCostPerToken: params.inputCostPerToken, outputCostPerToken: params.outputCostPerToken });
  m.addTokenUsage({
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextWindow: 0,
    responseId: `${params.promptTokens}:${params.completionTokens}`,
  });
  return m;
}

describe('ConversationStats', () => {
  it('registers llm metrics and combines', () => {
    const stats = new ConversationStats();
    const llmA = { llm: { usageId: 'a', metrics: makeMetrics(1) } };
    const llmB = { llm: { usageId: 'b', metrics: makeMetrics(2) } };

    stats.registerLlm(llmA);
    stats.registerLlm(llmB);

    expect(Object.keys(stats.usageToMetrics)).toEqual(['a', 'b']);

    const combined = stats.getCombinedMetrics().getSnapshot();
    expect(combined.accumulatedTokenUsage?.promptTokens).toBe(3);
  });

  it('serializes and restores from JSON', () => {
    const stats = new ConversationStats();
    stats.registerLlm({ llm: { usageId: 'a', metrics: makeMetrics(3) } });

    const json = stats.toJSON();
    const restored = ConversationStats.fromJSON(json);

    const m = restored.getMetricsForUsage('a');
    expect(m.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(3);
  });

  it('restores and merges metrics correctly on re-registration', () => {
    const stats = new ConversationStats();
    const m1 = makeMetrics(5);
    stats.registerLlm({ llm: { usageId: 'persistent', metrics: m1 } });

    // Simulate persistence round-trip
    const json = stats.toJSON();
    const restoredStats = ConversationStats.fromJSON(json);

    // Create a new stats object and restore state (like LocalConversation)
    const newStats = new ConversationStats();
    newStats.restore(restoredStats);

    // Re-register the same usageId with a fresh metrics object
    const m2 = new Metrics('m'); // empty initially
    newStats.registerLlm({ llm: { usageId: 'persistent', metrics: m2 } });

    // m2 should now contain the restored metrics (5 tokens)
    expect(m2.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(5);

    // Add more usage to m2
    m2.addTokenUsage({ promptTokens: 2, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: 'new' });

    // The stats object should reflect the total (7 tokens)
    const combined = newStats.getCombinedMetrics();
    expect(combined.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(7);

    // Ensure we don't double-count if we register again (though registerLlm is usually called once per client init)
    // But if we did:
    newStats.registerLlm({ llm: { usageId: 'persistent', metrics: m2 } });
    // Should not merge again because it's the same live metrics object
    expect(m2.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(7);
  });

  it('preserves accumulated metrics when replacing the metrics object multiple times', () => {
    const stats = new ConversationStats();
    const m1 = makeMetrics(2);
    stats.registerLlm({ llm: { usageId: 'switchy', metrics: m1 } });

    const m2 = new Metrics('m');
    stats.registerLlm({ llm: { usageId: 'switchy', metrics: m2 } });
    expect(m2.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(2);

    m2.addTokenUsage({ promptTokens: 3, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: 'more' });
    expect(m2.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(5);

    const m3 = new Metrics('m');
    stats.registerLlm({ llm: { usageId: 'switchy', metrics: m3 } });
    expect(m3.getSnapshot().accumulatedTokenUsage?.promptTokens).toBe(5);
  });

  it('combines accumulated cost across usage ids (best-effort)', () => {
    const stats = new ConversationStats();
    stats.registerLlm({
      llm: {
        usageId: 'a',
        metrics: makePricedMetrics({ promptTokens: 10, completionTokens: 5, inputCostPerToken: 0.001, outputCostPerToken: 0.002 }),
      },
    });
    stats.registerLlm({
      llm: {
        usageId: 'b',
        metrics: makePricedMetrics({ promptTokens: 2, completionTokens: 3, inputCostPerToken: 0.001, outputCostPerToken: 0.002 }),
      },
    });

    const combined = stats.getCombinedMetrics().getSnapshot();
    // (10+2)*0.001 + (5+3)*0.002 = 0.012 + 0.016 = 0.028
    expect(combined.accumulatedCost).toBeCloseTo(0.028);
  });
});
