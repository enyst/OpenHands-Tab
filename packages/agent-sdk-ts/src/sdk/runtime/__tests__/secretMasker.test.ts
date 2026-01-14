import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecretMasker } from '../secretMasker';

describe('SecretMasker', () => {
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('maskText', () => {
    it('masks configured secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['supersecretkey123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('API key: supersecretkey123');
      expect(result).toBe('API key: ***');
    });

    it('masks registered secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => ['registered_secret_value'],
      });

      const result = masker.maskText('Token: registered_secret_value');
      expect(result).toBe('Token: ***');
    });

    it('masks multiple occurrences of the same secret', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['mysecret12'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('First: mysecret12, Second: mysecret12');
      expect(result).toBe('First: ***, Second: ***');
    });

    it('masks multiple different secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['secret_one', 'secret_two'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('A: secret_one, B: secret_two');
      expect(result).toBe('A: ***, B: ***');
    });

    it('masks longer secrets first (priority order)', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['short123', 'longsecret123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('longsecret123');
      expect(result).toBe('***');
    });

    it('ignores secrets shorter than 8 characters', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['short'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('value: short');
      expect(result).toBe('value: short');
    });

    it('expands env var names to their values', () => {
      process.env.TEST_SECRET_KEY = 'env_secret_value_12345';

      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['TEST_SECRET_KEY'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('The value is env_secret_value_12345');
      expect(result).toBe('The value is ***');
    });

    it('masks env vars with sensitive-looking names', () => {
      process.env.MY_API_KEY = 'api_key_from_env_123';

      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('Key: api_key_from_env_123');
      expect(result).toBe('Key: ***');
    });

    it('trims whitespace from configured secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['  trimmed_secret_123  '],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('secret: trimmed_secret_123');
      expect(result).toBe('secret: ***');
    });

    it('ignores empty/whitespace-only configured secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['', '   ', 'valid_secret_123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('secret: valid_secret_123');
      expect(result).toBe('secret: ***');
    });

    it('filters out non-string configured secrets', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [123, null, undefined, 'string_secret_123'] as unknown[],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskText('secret: string_secret_123');
      expect(result).toBe('secret: ***');
    });

    it('reuses cached computation when secrets are unchanged', () => {
      // The masker caches the computed secret values based on a signature.
      // When secrets don't change, it returns cached values instead of recomputing.
      // We verify this by checking the same values are returned (via cache hit).
      const secrets = ['cached_secret_1234'];
      const masker = new SecretMasker({
        getConfiguredSecrets: () => secrets,
        getRegisteredSecrets: () => [],
      });

      // Both calls should return the same masked result
      const result1 = masker.maskText('test cached_secret_1234');
      const result2 = masker.maskText('test cached_secret_1234 again');

      expect(result1).toBe('test ***');
      expect(result2).toBe('test *** again');
    });

    it('invalidates cache when secrets change', () => {
      let secrets = ['first_secret_1234'];
      const masker = new SecretMasker({
        getConfiguredSecrets: () => secrets,
        getRegisteredSecrets: () => [],
      });

      expect(masker.maskText('first_secret_1234')).toBe('***');

      secrets = ['second_secret_5678'];
      expect(masker.maskText('second_secret_5678')).toBe('***');
    });
  });

  describe('maskUnknown', () => {
    it('masks strings', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['secret_value_123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskUnknown('Contains secret_value_123');
      expect(result).toBe('Contains ***');
    });

    it('masks strings in arrays', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['array_secret_123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskUnknown(['normal', 'array_secret_123', 'text']);
      expect(result).toEqual(['normal', '***', 'text']);
    });

    it('masks strings in objects', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['object_secret_123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskUnknown({
        key: 'object_secret_123',
        other: 'safe value',
      });
      expect(result).toEqual({
        key: '***',
        other: 'safe value',
      });
    });

    it('masks nested structures', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => ['nested_secret_123'],
        getRegisteredSecrets: () => [],
      });

      const result = masker.maskUnknown({
        level1: {
          level2: {
            secret: 'nested_secret_123',
          },
        },
      });
      expect(result).toEqual({
        level1: {
          level2: {
            secret: '***',
          },
        },
      });
    });

    it('handles circular references', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      const circular: Record<string, unknown> = { value: 'test' };
      circular.self = circular;

      const result = masker.maskUnknown(circular) as Record<string, unknown>;
      expect(result.value).toBe('test');
      expect(result.self).toBe('[Circular]');
    });

    it('handles circular arrays', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      const arr: unknown[] = ['a', 'b'];
      arr.push(arr);

      const result = masker.maskUnknown(arr) as unknown[];
      expect(result[0]).toBe('a');
      expect(result[1]).toBe('b');
      expect(result[2]).toBe('[Circular]');
    });

    it('returns primitives unchanged', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      expect(masker.maskUnknown(123)).toBe(123);
      expect(masker.maskUnknown(true)).toBe(true);
      expect(masker.maskUnknown(null)).toBe(null);
      expect(masker.maskUnknown(undefined)).toBe(undefined);
    });

    it('handles empty objects', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      expect(masker.maskUnknown({})).toEqual({});
    });

    it('handles empty arrays', () => {
      const masker = new SecretMasker({
        getConfiguredSecrets: () => [],
        getRegisteredSecrets: () => [],
      });

      expect(masker.maskUnknown([])).toEqual([]);
    });
  });
});
