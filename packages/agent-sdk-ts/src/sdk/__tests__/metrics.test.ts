import { describe, it, expect } from 'vitest';
import { Metrics } from '../llm/metrics';

describe('Metrics', () => {
  it('adds token usage and response latency and computes snapshot', () => {
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
    m.addResponseLatency(1.25, 'r1');

    const snap = m.getSnapshot();
    expect(snap.accumulatedTokenUsage).toBeTruthy();
    expect(snap.accumulatedTokenUsage?.promptTokens).toBe(100);
    expect(snap.accumulatedTokenUsage?.completionTokens).toBe(50);
    const json = m.toJSON();
    expect(Array.isArray(json.responseLatencies)).toBe(true);
    expect((json.responseLatencies as unknown[]).length).toBe(1);
  });

  it('serializes and deserializes via JSON', () => {
    const m = new Metrics('claude-3');
    m.addTokenUsage({ promptTokens: 1, completionTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, contextWindow: 0, responseId: 'x' });
    m.addResponseLatency(0.5, 'x');

    const json = m.toJSON();
    const m2 = Metrics.fromJSON(json);
    expect(m2.modelName).toBe('claude-3');
    const json2 = m2.toJSON();
    expect((json2.responseLatencies as unknown[]).length).toBe(1);
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

  it('caps arrays at MAX_HISTORY_ENTRIES (10) to prevent unbounded growth', () => {
    const m = new Metrics('test-model', { inputCostPerToken: 0.001, outputCostPerToken: 0.002 });

    // Add 15 token usages
    for (let i = 0; i < 15; i++) {
      m.addTokenUsage({ promptTokens: 10, completionTokens: 5, responseId: `r${i}` });
    }

    const json = m.toJSON();
    expect((json.tokenUsages as unknown[]).length).toBe(10);
    expect((json.costs as unknown[]).length).toBe(10);

    // Last should still be the most recent
    expect(m.lastTokenUsage?.responseId).toBe('r14');

    // Accumulated should sum all 15
    expect(m.accumulatedTokenUsage?.promptTokens).toBe(150);
  });

  it('caps arrays after merge', () => {
    const a = new Metrics('m');
    const b = new Metrics('m');

    // Add 8 to each (total 16 after merge)
    for (let i = 0; i < 8; i++) {
      a.addTokenUsage({ promptTokens: 1, completionTokens: 1, responseId: `a${i}` });
      b.addTokenUsage({ promptTokens: 2, completionTokens: 2, responseId: `b${i}` });
    }

    a.merge(b);
    const json = a.toJSON();
    expect((json.tokenUsages as unknown[]).length).toBe(10);

    // Last should be from merged (b's last)
    expect(a.lastTokenUsage?.responseId).toBe('b7');
  });

  it('restores last* fields from JSON when arrays are capped', () => {
    const m = new Metrics('test-model');
    for (let i = 0; i < 15; i++) {
      m.addTokenUsage({ promptTokens: i, completionTokens: 0, responseId: `r${i}` });
    }

    const json = m.toJSON();
    const restored = Metrics.fromJSON(json);

    // lastTokenUsage should be preserved even though array is capped
    expect(restored.lastTokenUsage?.responseId).toBe('r14');
    expect(restored.lastTokenUsage?.promptTokens).toBe(14);
  });

  it('falls back to array tail for last* when not explicitly stored', () => {
    // Simulate legacy JSON without last* fields
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
