import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS } from '../types';

describe('LLM timeout defaults', () => {
  it('defaults to 300s (Python parity)', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(300_000);
  });
});

