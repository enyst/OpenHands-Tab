import { describe, it, expect } from 'vitest';
import { Metrics } from '../llm/metrics';

describe('Metrics', () => {
  it('adds token usage and computes snapshot', () => {
    const m = new Metrics('gpt-4o');
    expect(m.getSnapshot()).toMatchObject({
      modelName: 'gpt-4o',
      accumulatedCost: 0,
    });

    m.addTokenUsage({
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      contextWindow: 0,
      responseId: 'r1',
    });
    // addResponseLatency is a no-op but should not throw
    m.addResponseLatency(1.25, 'r1');

    const snap = m.getSnapshot();
    expect(snap.accumulatedTokenUsage).toBeTruthy();
    expect(snap.accumulatedTokenUsage?.promptTokens).toBe(100);
    expect(snap.accumulatedTokenUsage?.completionTokens).toBe(50);
  });

  it('serializes and deserializes via JSON', () => {
    const m = new Metrics('claude-3');
    m.addTokenUsage({ promptTokens: 1, completionTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: 'x' });

    const json = m.toJSON();
    const m2 = Metrics.fromJSON(json);
    expect(m2.modelName).toBe('claude-3');
    expect(m2.lastTokenUsage?.responseId).toBe('x');
    expect(m2.accumulatedTokenUsage?.promptTokens).toBe(1);
  });

  it('merges metrics', () => {
    const a = new Metrics('m');
    const b = new Metrics('m');
    a.addTokenUsage({ promptTokens: 2, completionTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 1, contextWindow: 0, responseId: 'a' });
    b.addTokenUsage({ promptTokens: 5, completionTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 0, contextWindow: 0, responseId: 'b' });

    a.merge(b);
    const snap = a.getSnapshot();
    expect(snap.accumulatedTokenUsage?.promptTokens).toBe(7);
    expect(snap.accumulatedTokenUsage?.completionTokens).toBe(10);
    // Last should be from merged (b's)
    expect(snap.lastTokenUsage?.responseId).toBe('b');
  });

  it('tracks costs', () => {
    const m = new Metrics('costly-model');
    m.addCost(0.05);
    m.addCost(0.02);
    expect(m.accumulatedCost).toBeCloseTo(0.07);
    const snap = m.getSnapshot();
    expect(snap.accumulatedCost).toBeCloseTo(0.07);
  });

  it('computes cost from token usage when cost rates are configured', () => {
    const m = new Metrics('priced-model', { inputCostPerToken: 0.001, outputCostPerToken: 0.002 });
    m.addTokenUsage({
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: 0,
      responseId: 'r1',
    });

    expect(m.accumulatedCost).toBeCloseTo(0.2);

    m.addTokenUsage({
      promptTokens: 10,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: 0,
      responseId: 'r2',
    });

    expect(m.accumulatedCost).toBeCloseTo(0.21);
  });

  it('adjusts input cost when cache token rates are configured', () => {
    const m = new Metrics('priced-model', {
      inputCostPerToken: 0.001,
      outputCostPerToken: 0.002,
      cacheReadCostPerToken: 0.0002,
      cacheWriteCostPerToken: 0.0015,
    });
    m.addTokenUsage({
      promptTokens: 100,
      completionTokens: 10,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      contextWindow: 0,
      responseId: 'r1',
    });

    // Base: 100*0.001 + 10*0.002 = 0.12
    // Cache read adjustment: 40*(0.0002 - 0.001) = -0.032
    // Cache write adjustment: 10*(0.0015 - 0.001) = +0.005
    // Total = 0.093
    expect(m.accumulatedCost).toBeCloseTo(0.093);
  });

  it('does not compute cost when cost rates are not configured', () => {
    const m = new Metrics('model-without-rates');
    m.addTokenUsage({
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      contextWindow: 0,
      responseId: 'r1',
    });
    expect(m.accumulatedCost).toBe(0);
  });

  it('tracks last* values for most recent entries', () => {
    const m = new Metrics('test-model');
    m.addTokenUsage({ promptTokens: 10, completionTokens: 5, responseId: 'r1' });
    m.addTokenUsage({ promptTokens: 20, completionTokens: 10, responseId: 'r2' });

    const snap = m.getSnapshot();
    expect(snap.lastTokenUsage?.responseId).toBe('r2');
    expect(snap.lastTokenUsage?.promptTokens).toBe(20);

    // Accumulated should sum all
    expect(snap.accumulatedTokenUsage?.promptTokens).toBe(30);
  });

  it('accumulates all token usage without unbounded array growth', () => {
    const m = new Metrics('test-model', { inputCostPerToken: 0.001, outputCostPerToken: 0.002 });

    // Add 15 token usages
    for (let i = 0; i < 15; i++) {
      m.addTokenUsage({ promptTokens: 10, completionTokens: 5, responseId: `r${i}` });
    }

    const json = m.toJSON();
    // No arrays in simplified version
    expect(json.tokenUsages).toBeUndefined();
    expect(json.costs).toBeUndefined();
    expect(json.responseLatencies).toBeUndefined();

    // Last should still be the most recent
    expect(m.lastTokenUsage?.responseId).toBe('r14');

    // Accumulated should sum all 15
    expect(m.accumulatedTokenUsage?.promptTokens).toBe(150);
  });

  it('merge preserves accumulated totals', () => {
    const a = new Metrics('m');
    const b = new Metrics('m');

    // Add 8 to each (total 16 after merge)
    for (let i = 0; i < 8; i++) {
      a.addTokenUsage({ promptTokens: 1, completionTokens: 1, responseId: `a${i}` });
      b.addTokenUsage({ promptTokens: 2, completionTokens: 2, responseId: `b${i}` });
    }

    a.merge(b);
    // Accumulated: a had 8*1=8, b had 8*2=16, total=24
    expect(a.accumulatedTokenUsage?.promptTokens).toBe(24);

    // Last should be from merged (b's last)
    expect(a.lastTokenUsage?.responseId).toBe('b7');
  });

  it('restores fields from JSON correctly', () => {
    const m = new Metrics('test-model');
    for (let i = 0; i < 15; i++) {
      m.addTokenUsage({ promptTokens: i, completionTokens: 0, responseId: `r${i}` });
    }

    const json = m.toJSON();
    const restored = Metrics.fromJSON(json);

    // lastTokenUsage should be preserved
    expect(restored.lastTokenUsage?.responseId).toBe('r14');
    expect(restored.lastTokenUsage?.promptTokens).toBe(14);

    // accumulatedTokenUsage should be preserved (sum of 0+1+...+14 = 105)
    expect(restored.accumulatedTokenUsage?.promptTokens).toBe(105);
  });

  it('falls back to array tail for last* when reading legacy JSON', () => {
    // Simulate legacy JSON with tokenUsages array
    const legacyJson = {
      modelName: 'legacy-model',
      accumulatedCost: 0,
      tokenUsages: [
        { model: 'legacy-model', promptTokens: 10, completionTokens: 5, responseId: 'old1' },
        { model: 'legacy-model', promptTokens: 20, completionTokens: 10, responseId: 'old2' },
      ],
      costs: [],
      responseLatencies: [],
    };

    const restored = Metrics.fromJSON(legacyJson);
    expect(restored.lastTokenUsage?.responseId).toBe('old2');
    expect(restored.lastTokenUsage?.promptTokens).toBe(20);
  });
});
