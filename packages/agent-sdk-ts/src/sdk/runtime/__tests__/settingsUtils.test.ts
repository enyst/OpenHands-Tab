import { describe, it, expect } from 'vitest';
import { toOptionalNonEmptyString, isSafeProfileId } from '../settingsUtils';

describe('settingsUtils', () => {
  describe('toOptionalNonEmptyString', () => {
    it('returns undefined for undefined input', () => {
      expect(toOptionalNonEmptyString(undefined)).toBe(undefined);
    });

    it('returns undefined for non-string input', () => {
      expect(toOptionalNonEmptyString(123)).toBe(undefined);
      expect(toOptionalNonEmptyString(null)).toBe(undefined);
      expect(toOptionalNonEmptyString({})).toBe(undefined);
      expect(toOptionalNonEmptyString([])).toBe(undefined);
      expect(toOptionalNonEmptyString(true)).toBe(undefined);
    });

    it('returns undefined for empty string', () => {
      expect(toOptionalNonEmptyString('')).toBe(undefined);
    });

    it('returns undefined for whitespace-only string', () => {
      expect(toOptionalNonEmptyString('   ')).toBe(undefined);
      expect(toOptionalNonEmptyString('\t')).toBe(undefined);
      expect(toOptionalNonEmptyString('\n')).toBe(undefined);
    });

    it('returns trimmed string for valid input', () => {
      expect(toOptionalNonEmptyString('  hello  ')).toBe('hello');
      expect(toOptionalNonEmptyString('value')).toBe('value');
    });

    it('preserves internal whitespace', () => {
      expect(toOptionalNonEmptyString('  hello world  ')).toBe('hello world');
    });
  });

  describe('isSafeProfileId', () => {
    it('returns true for valid profile IDs', () => {
      expect(isSafeProfileId('default')).toBe(true);
      expect(isSafeProfileId('my-profile')).toBe(true);
      expect(isSafeProfileId('profile_1')).toBe(true);
      expect(isSafeProfileId('Profile123')).toBe(true);
    });

    it('returns true for alphanumeric IDs', () => {
      expect(isSafeProfileId('abc123')).toBe(true);
      expect(isSafeProfileId('ABC123')).toBe(true);
    });

    it('returns true for IDs with allowed special chars', () => {
      expect(isSafeProfileId('my-profile')).toBe(true);
      expect(isSafeProfileId('my_profile')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isSafeProfileId('')).toBe(false);
    });

    it('returns false for IDs with invalid characters', () => {
      expect(isSafeProfileId('profile/name')).toBe(false);
      expect(isSafeProfileId('profile\\name')).toBe(false);
      expect(isSafeProfileId('profile:name')).toBe(false);
      expect(isSafeProfileId('../evil')).toBe(false);
    });

    it('returns false for IDs with spaces', () => {
      expect(isSafeProfileId('my profile')).toBe(false);
    });

    it('allows IDs starting with dot', () => {
      // The regex allows dots anywhere: /^[a-zA-Z0-9._-]+$/
      expect(isSafeProfileId('.hidden')).toBe(true);
    });

    it('allows IDs with dots', () => {
      expect(isSafeProfileId('profile.v2')).toBe(true);
    });

    it('allows long IDs', () => {
      // No length limit in validation
      const longId = 'a'.repeat(200);
      expect(isSafeProfileId(longId)).toBe(true);
    });
  });
});
