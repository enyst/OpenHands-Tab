import { describe, expect, it } from 'vitest';
import { safeStringify } from '../safeStringify';

describe('safeStringify', () => {
  it('redacts auth-like strings in values', () => {
    const result = safeStringify({ message: 'Authorization: Bearer SECRET' });
    expect(result).toContain('Authorization: Bearer [REDACTED]');
  });

  it('redacts URL-embedded credentials', () => {
    const result = safeStringify({ url: 'https://user:pass@example.com/path' });
    expect(result).toContain('https://[REDACTED]@example.com/path');
  });

  it('redacts known secret keys', () => {
    const result = safeStringify({ apiKey: 'nope', nested: { accessToken: 'nope2' } });
    expect(result).toContain('"apiKey":"[REDACTED]"');
    expect(result).toContain('"accessToken":"[REDACTED]"');
  });
});
