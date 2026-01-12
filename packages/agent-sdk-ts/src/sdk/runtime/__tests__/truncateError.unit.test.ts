import { describe, expect, it } from 'vitest';
import { truncateError } from '../toolCallErrorEvents';

describe('truncateError', () => {
  it('returns empty string when max <= 0', () => {
    expect(truncateError('anything', 0)).toBe('');
    expect(truncateError('anything', -5)).toBe('');
  });

  it('returns default message for empty or whitespace-only input', () => {
    expect(truncateError('')).toBe('Unknown tool error');
    expect(truncateError('   ')).toBe('Unknown tool error');
    expect(truncateError('\n\t')).toBe('Unknown tool error');
  });

  it('hard-caps to max when too small for clip marker', () => {
    const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const out = truncateError(input, 5);
    expect(out).toHaveLength(5);
    expect(out).toBe('ABCDE');
  });

  it('clips long messages using the shared tool-message clip marker', () => {
    const input = '0123456789'.repeat(1000);
    const out = truncateError(input, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('<response clipped>');
  });

  it('preserves whitespace before truncation (python parity)', () => {
    const input = 'a\n\n\t b     c';
    const out = truncateError(input, 100);
    expect(out).toBe(input);
  });
});
