import { describe, it, expect } from 'vitest';
import {
  CIRCULAR_REFERENCE_MARKER,
  TOOL_MESSAGE_CLIP_MARKER,
  TOOL_MESSAGE_MAX_CHARS,
  deepTruncate,
  truncateToolMessage,
} from '../toolResultTruncation';

describe('toolResultTruncation', () => {
  describe('constants', () => {
    it('has correct circular reference marker', () => {
      expect(CIRCULAR_REFERENCE_MARKER).toBe('[Circular]');
    });

    it('has correct clip marker', () => {
      expect(TOOL_MESSAGE_CLIP_MARKER).toBe('<response clipped>');
    });

    it('has correct max chars', () => {
      expect(TOOL_MESSAGE_MAX_CHARS).toBe(8000);
    });
  });

  describe('deepTruncate', () => {
    it('returns primitives unchanged', () => {
      expect(deepTruncate(123)).toBe(123);
      expect(deepTruncate(true)).toBe(true);
      expect(deepTruncate(null)).toBe(null);
      expect(deepTruncate(undefined)).toBe(undefined);
    });

    it('truncates long strings', () => {
      const longString = 'x'.repeat(20000);
      const result = deepTruncate(longString) as string;
      expect(result.length).toBeLessThan(longString.length);
    });

    it('handles short strings', () => {
      expect(deepTruncate('short')).toBe('short');
    });

    it('truncates strings in arrays', () => {
      const longString = 'y'.repeat(20000);
      const result = deepTruncate(['short', longString]) as string[];
      expect(result[0]).toBe('short');
      expect(result[1].length).toBeLessThan(longString.length);
    });

    it('truncates strings in objects', () => {
      const longString = 'z'.repeat(20000);
      const result = deepTruncate({ key: longString }) as Record<string, string>;
      expect(result.key.length).toBeLessThan(longString.length);
    });

    it('handles nested objects', () => {
      const result = deepTruncate({
        level1: {
          level2: {
            value: 'test',
          },
        },
      }) as Record<string, Record<string, Record<string, string>>>;
      expect(result.level1.level2.value).toBe('test');
    });

    it('handles Date objects', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const result = deepTruncate(date);
      expect(result).toBe('2024-01-15T12:00:00.000Z');
    });

    it('handles invalid Date objects', () => {
      const invalidDate = new Date('invalid');
      const result = deepTruncate(invalidDate);
      expect(result).toBe('Invalid Date');
    });

    it('handles circular references in objects', () => {
      const obj: Record<string, unknown> = { value: 'test' };
      obj.self = obj;
      const result = deepTruncate(obj) as Record<string, unknown>;
      expect(result.value).toBe('test');
      expect(result.self).toBe(CIRCULAR_REFERENCE_MARKER);
    });

    it('handles circular references in arrays', () => {
      const arr: unknown[] = ['a', 'b'];
      arr.push(arr);
      const result = deepTruncate(arr) as unknown[];
      expect(result[0]).toBe('a');
      expect(result[1]).toBe('b');
      expect(result[2]).toBe(CIRCULAR_REFERENCE_MARKER);
    });

    it('handles empty objects', () => {
      expect(deepTruncate({})).toEqual({});
    });

    it('handles empty arrays', () => {
      expect(deepTruncate([])).toEqual([]);
    });
  });

  describe('truncateToolMessage', () => {
    it('returns short messages unchanged', () => {
      const message = 'This is a short message';
      expect(truncateToolMessage(message)).toBe(message);
    });

    it('returns messages at max length unchanged', () => {
      const message = 'x'.repeat(TOOL_MESSAGE_MAX_CHARS);
      expect(truncateToolMessage(message)).toBe(message);
    });

    it('truncates messages over max length', () => {
      const message = 'y'.repeat(TOOL_MESSAGE_MAX_CHARS + 1000);
      const result = truncateToolMessage(message);
      expect(result.length).toBeLessThan(message.length);
      expect(result).toContain(TOOL_MESSAGE_CLIP_MARKER);
    });

    it('preserves head and tail of long messages', () => {
      const message = 'HEAD'.repeat(3000) + 'TAIL'.repeat(3000);
      const result = truncateToolMessage(message);
      expect(result.startsWith('HEAD')).toBe(true);
      expect(result.endsWith('TAIL')).toBe(true);
    });

    it('respects custom maxChars', () => {
      const message = 'x'.repeat(200);
      const result = truncateToolMessage(message, 100);
      expect(result.length).toBeLessThan(200);
      expect(result).toContain(TOOL_MESSAGE_CLIP_MARKER);
    });

    it('handles edge case of very small maxChars', () => {
      const message = 'x'.repeat(100);
      const result = truncateToolMessage(message, 30);
      expect(result).toContain(TOOL_MESSAGE_CLIP_MARKER);
    });

    it('contains clip marker with newlines', () => {
      const message = 'x'.repeat(10000);
      const result = truncateToolMessage(message);
      expect(result).toContain(`\n${TOOL_MESSAGE_CLIP_MARKER}\n`);
    });
  });
});
