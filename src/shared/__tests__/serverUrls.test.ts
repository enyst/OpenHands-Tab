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

  it('preserves existing http/https normalization behavior', () => {
    expect(normalizeServerUrl('example.com')).toEqual({ ok: true, url: 'http://example.com' });
    expect(normalizeServerUrl('http:example.com')).toEqual({ ok: true, url: 'http://example.com' });
    expect(normalizeServerUrl('https:example.com')).toEqual({ ok: true, url: 'https://example.com' });
  });
});

