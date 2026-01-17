import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from '../serverUrls';

describe('server URL normalization', () => {
  it('accepts ws:// inputs by normalizing to http://', () => {
    expect(normalizeServerUrl('ws://example.com')).toEqual({ ok: true, url: 'http://example.com' });
    expect(normalizeServerUrl('ws://example.com/')).toEqual({ ok: true, url: 'http://example.com' });
  });

  it('accepts wss:// inputs by normalizing to https://', () => {
    expect(normalizeServerUrl('wss://example.com')).toEqual({ ok: true, url: 'https://example.com' });
    expect(normalizeServerUrl('wss://example.com/')).toEqual({ ok: true, url: 'https://example.com' });
  });

  it('rejects invalid ws/wss hosts', () => {
    expect(normalizeServerUrl('ws://').ok).toBe(false);
    expect(normalizeServerUrl('wss://').ok).toBe(false);
  });

  it('defaults to https:// for non-local hostnames without a scheme', () => {
    expect(normalizeServerUrl('example.com')).toEqual({ ok: true, url: 'https://example.com' });
  });

  it('defaults to http:// for local hostnames without a scheme', () => {
    expect(normalizeServerUrl('localhost')).toEqual({ ok: true, url: 'http://localhost' });
    expect(normalizeServerUrl('localhost:3000')).toEqual({ ok: true, url: 'http://localhost:3000' });
    expect(normalizeServerUrl('127.0.0.1:3000')).toEqual({ ok: true, url: 'http://127.0.0.1:3000' });
    expect(normalizeServerUrl('::1')).toEqual({ ok: true, url: 'http://[::1]' });
    expect(normalizeServerUrl('::1:3000')).toEqual({ ok: true, url: 'http://[::1]:3000' });
    expect(normalizeServerUrl('[::1]:3000')).toEqual({ ok: true, url: 'http://[::1]:3000' });
  });

  it('preserves existing http/https normalization behavior when the scheme is provided', () => {
    expect(normalizeServerUrl('http:example.com')).toEqual({ ok: true, url: 'http://example.com' });
    expect(normalizeServerUrl('https:example.com')).toEqual({ ok: true, url: 'https://example.com' });
  });
});
