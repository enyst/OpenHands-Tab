import { describe, it, expect } from 'vitest';
import { safeStringify } from '../shared/safeStringify';

describe('safeStringify', () => {
  it('redacts hyphenated api key headers', () => {
    expect(safeStringify({ 'x-goog-api-key': 'abc123' })).toBe('{"x-goog-api-key":"[REDACTED]"}');
    expect(safeStringify({ 'xi-api-key': 'def456' })).toBe('{"xi-api-key":"[REDACTED]"}');
  });
});

