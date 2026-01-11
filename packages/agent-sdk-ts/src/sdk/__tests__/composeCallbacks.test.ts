import { describe, expect, it, vi } from 'vitest';
import { composeCallbacks } from '../utils/composeCallbacks';

describe('composeCallbacks', () => {
  it('invokes callbacks in order and skips null/undefined', () => {
    const calls: string[] = [];
    const a = vi.fn((value: string) => calls.push(`a:${value}`));
    const b = vi.fn((value: string) => calls.push(`b:${value}`));

    const composed = composeCallbacks<string>([a, null, undefined, b]);
    composed('x');

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['a:x', 'b:x']);
  });

  it('works with an empty callback list', () => {
    const composed = composeCallbacks<number>([]);
    expect(() => composed(123)).not.toThrow();
  });
});
