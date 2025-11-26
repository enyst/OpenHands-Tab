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

  it('does not append suffix when max < suffix length; caps hard at max', () => {
    const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    // suffix length is 12; choose max smaller than suffix length
    const out = truncateError(input, 5);
    expect(out).toHaveLength(5);
    expect(out).toBe('ABCDE');
  });

  it('appends suffix when there is room (max >= suffix length + 1)', () => {
    const input = '0123456789'.repeat(1000);
    const out = truncateError(input, 50);
    expect(out.endsWith('(truncated)')).toBe(true);
    expect(out.length).toBe(50);
  });

  it('normalizes whitespace before truncation', () => {
    const input = 'a\n\n\t b     c';
    const out = truncateError(input, 100);
    expect(out).toBe('a b c');
  });
});
