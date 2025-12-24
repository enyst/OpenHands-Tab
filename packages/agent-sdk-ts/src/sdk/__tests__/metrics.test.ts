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
});
