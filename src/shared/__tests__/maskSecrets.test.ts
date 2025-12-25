import { describe, it, expect } from 'vitest';
import { maskSecretsInText } from '../maskSecrets';

describe('maskSecretsInText', () => {
  it('returns the original text when no secrets are provided', () => {
    expect(maskSecretsInText('hello', undefined)).toBe('hello');
  });

  it('masks registered secret values', () => {
    const secrets = { getRegisteredValues: () => ['  abcdef  '] };
    expect(maskSecretsInText('token=abcdef token=abcdef', secrets)).toBe('token=[REDACTED] token=[REDACTED]');
  });

  it('ignores registered values that are too short', () => {
    const secrets = { getRegisteredValues: () => ['abc'] };
    expect(maskSecretsInText('token=abc token=abc', secrets)).toBe('token=abc token=abc');
  });
});

