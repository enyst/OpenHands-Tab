import { beforeAll, describe, expect, it } from 'vitest';

type ParserFn = (raw: string) => string[][];

let parseCycleJson: ParserFn;

beforeAll(async () => {
  const mod = await import('../../scripts/check-circular-deps.mjs');
  parseCycleJson = mod.parseCycleJson as ParserFn;
});

describe('parseCycleJson', () => {
  it('parses strict JSON payloads', () => {
    expect(parseCycleJson('[["a.ts","b.ts"]]')).toEqual([['a.ts', 'b.ts']]);
  });

  it('returns empty cycles for empty output', () => {
    expect(parseCycleJson('   \n\t')).toEqual([]);
  });

  it('parses embedded JSON payloads with noisy output', () => {
    const raw = '[warning] transient output\n[["a.ts","b.ts"],["c.ts","d.ts"]]\nDone.';
    expect(parseCycleJson(raw)).toEqual([
      ['a.ts', 'b.ts'],
      ['c.ts', 'd.ts'],
    ]);
  });

  it('skips non-cycle arrays before finding the payload', () => {
    const raw = '[1,2,3]\n[["x.ts","y.ts"]]';
    expect(parseCycleJson(raw)).toEqual([['x.ts', 'y.ts']]);
  });

  it('throws with context when no valid payload can be parsed', () => {
    expect(() => parseCycleJson('not-json-output')).toThrow(/Unexpected madge output/);
  });
});
