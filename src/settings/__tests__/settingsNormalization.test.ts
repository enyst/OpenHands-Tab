import { describe, expect, it } from 'vitest';
import {
  isSafeProfileId,
  normalizeOracleProfileId,
  normalizeSavedServers,
  normalizeServerSettings,
} from '../settingsNormalization';

describe('settingsNormalization', () => {
  it('normalizes and deduplicates saved servers', () => {
    const result = normalizeSavedServers([
      { url: ' http://localhost:3000 ' },
      { url: 'http://localhost:3000', label: ' Local ' },
      { url: 'https://example.com:1234', label: '  Example  ' },
      { url: '  ' },
    ], []);

    expect(result.changed).toBe(true);
    expect(result.dropped).toBe(1);
    expect(result.servers).toEqual([
      { url: 'http://localhost:3000', label: 'Local' },
      { url: 'https://example.com:1234', label: 'Example' },
    ]);
  });

  it('normalizes server settings and ensures primary server exists in list', () => {
    const result = normalizeServerSettings(' http://localhost:4321 ', [{ url: 'https://example.com:1234' }], []);
    expect(result.serverUrl).toBe('http://localhost:4321');
    expect(result.changed).toBe(true);
    expect(result.servers).toEqual([
      { url: 'https://example.com:1234' },
      { url: 'http://localhost:4321' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('returns validation warnings for invalid server and oracle values', () => {
    const serverResult = normalizeServerSettings('http:///', [{ foo: 'bar' }], []);
    expect(serverResult.changed).toBe(true);
    expect(serverResult.warnings).toEqual([
      'Invalid server URL: Invalid URL format',
      'Dropped 1 invalid saved server entry.',
    ]);

    const oracleResult = normalizeOracleProfileId('bad/id', true);
    expect(oracleResult.profileId).toBeUndefined();
    expect(oracleResult.warnings).toEqual([
      'Oracle profile id is null. Clear the setting or set a valid string.',
      'Invalid oracle LLM profile id: bad/id',
    ]);
  });

  it('accepts safe profile ids only', () => {
    expect(isSafeProfileId('gpt-5-mini')).toBe(true);
    expect(isSafeProfileId(' profile ')).toBe(false);
    expect(isSafeProfileId('bad/id')).toBe(false);
  });
});
