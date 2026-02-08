import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl } from '../../shared/remoteUrl';

describe('normalizeRemoteUrl', () => {
  it('trims whitespace and removes trailing slashes', () => {
    expect(normalizeRemoteUrl('  http://example.com///  ')).toBe('http://example.com');
  });

  it('adds http:// when scheme is missing', () => {
    expect(normalizeRemoteUrl('example.com')).toBe('http://example.com');
  });

  it('converts ws:// and wss:// to http:// and https://', () => {
    expect(normalizeRemoteUrl('ws://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeRemoteUrl('wss://localhost:3000/')).toBe('https://localhost:3000');
  });

  it('preserves non-web schemes', () => {
    expect(normalizeRemoteUrl('foo+bar://baz/qux/')).toBe('foo+bar://baz/qux');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeRemoteUrl('   ')).toBe('');
  });
});

