import { describe, expect, it } from 'vitest';
import { buildVerificationUriComplete, normalizeHttpBaseUrl } from '../url';

describe('auth url helpers', () => {
  describe('buildVerificationUriComplete', () => {
    it('preserves existing query params and sets user_code', () => {
      const out = buildVerificationUriComplete('https://example.com/verify?foo=bar', 'ABC-123');
      const url = new URL(out);
      expect(url.origin).toBe('https://example.com');
      expect(url.pathname).toBe('/verify');
      expect(url.searchParams.get('foo')).toBe('bar');
      expect(url.searchParams.get('user_code')).toBe('ABC-123');
    });

    it('overrides an existing user_code param', () => {
      const out = buildVerificationUriComplete('https://example.com/verify?user_code=OLD&foo=bar', 'NEW');
      const url = new URL(out);
      expect(url.searchParams.get('user_code')).toBe('NEW');
      expect(url.searchParams.get('foo')).toBe('bar');
    });

    it('preserves hash fragments', () => {
      expect(buildVerificationUriComplete('https://example.com/verify#section', 'CODE'))
        .toBe('https://example.com/verify?user_code=CODE#section');
    });
  });

  describe('normalizeHttpBaseUrl', () => {
    it('normalizes ws:// and wss:// to http(s)://', () => {
      expect(normalizeHttpBaseUrl('ws://example.com/api')).toEqual({ ok: true, url: 'http://example.com/api' });
      expect(normalizeHttpBaseUrl('wss://example.com/api')).toEqual({ ok: true, url: 'https://example.com/api' });
    });

    it('strips trailing slashes, query, and hash', () => {
      expect(normalizeHttpBaseUrl('https://example.com/v1/?x=1#y'))
        .toEqual({ ok: true, url: 'https://example.com/v1' });
    });

    it('defaults to http:// when scheme is missing', () => {
      expect(normalizeHttpBaseUrl('example.com/v1')).toEqual({ ok: true, url: 'http://example.com/v1' });
    });
  });
});

