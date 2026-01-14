import { describe, it, expect } from 'vitest';
import {
  requireObject,
  requireString,
  optionalString,
  requireBoolean,
  optionalNumber,
} from '../validation';

describe('validation utilities', () => {
  describe('requireObject', () => {
    it('returns valid object', () => {
      const obj = { foo: 'bar' };
      expect(requireObject(obj, 'test')).toBe(obj);
    });

    it('returns empty object', () => {
      const obj = {};
      expect(requireObject(obj, 'test')).toBe(obj);
    });

    it('throws for null', () => {
      expect(() => requireObject(null, 'field')).toThrow('field must be an object');
    });

    it('throws for undefined', () => {
      expect(() => requireObject(undefined, 'field')).toThrow('field must be an object');
    });

    it('throws for string', () => {
      expect(() => requireObject('string', 'field')).toThrow('field must be an object');
    });

    it('throws for number', () => {
      expect(() => requireObject(123, 'field')).toThrow('field must be an object');
    });

    it('throws for boolean', () => {
      expect(() => requireObject(true, 'field')).toThrow('field must be an object');
    });

    it('accepts arrays (which are objects)', () => {
      const arr = [1, 2, 3];
      expect(requireObject(arr, 'test')).toBe(arr);
    });
  });

  describe('requireString', () => {
    it('returns valid string', () => {
      expect(requireString('hello', 'field')).toBe('hello');
    });

    it('returns string with content', () => {
      expect(requireString('test value', 'field')).toBe('test value');
    });

    it('throws for empty string', () => {
      expect(() => requireString('', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for whitespace-only string', () => {
      expect(() => requireString('   ', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for null', () => {
      expect(() => requireString(null, 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for undefined', () => {
      expect(() => requireString(undefined, 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for number', () => {
      expect(() => requireString(123, 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for object', () => {
      expect(() => requireString({}, 'field')).toThrow('field must be a non-empty string');
    });

    it('returns string with leading/trailing whitespace', () => {
      expect(requireString('  hello  ', 'field')).toBe('  hello  ');
    });
  });

  describe('optionalString', () => {
    it('returns undefined for undefined input', () => {
      expect(optionalString(undefined, 'field')).toBe(undefined);
    });

    it('returns string for valid string', () => {
      expect(optionalString('hello', 'field')).toBe('hello');
    });

    it('throws for empty string', () => {
      expect(() => optionalString('', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for whitespace-only string', () => {
      expect(() => optionalString('   ', 'field')).toThrow('field must be a non-empty string');
    });

    it('throws for non-string non-undefined values', () => {
      expect(() => optionalString(123, 'field')).toThrow('field must be a non-empty string');
      expect(() => optionalString(null, 'field')).toThrow('field must be a non-empty string');
      expect(() => optionalString({}, 'field')).toThrow('field must be a non-empty string');
    });
  });

  describe('requireBoolean', () => {
    it('returns true for true', () => {
      expect(requireBoolean(true, 'field')).toBe(true);
    });

    it('returns false for false', () => {
      expect(requireBoolean(false, 'field')).toBe(false);
    });

    it('throws for string', () => {
      expect(() => requireBoolean('true', 'field')).toThrow('field must be a boolean');
    });

    it('throws for number', () => {
      expect(() => requireBoolean(1, 'field')).toThrow('field must be a boolean');
      expect(() => requireBoolean(0, 'field')).toThrow('field must be a boolean');
    });

    it('throws for null', () => {
      expect(() => requireBoolean(null, 'field')).toThrow('field must be a boolean');
    });

    it('throws for undefined', () => {
      expect(() => requireBoolean(undefined, 'field')).toThrow('field must be a boolean');
    });

    it('throws for object', () => {
      expect(() => requireBoolean({}, 'field')).toThrow('field must be a boolean');
    });
  });

  describe('optionalNumber', () => {
    it('returns undefined for undefined input', () => {
      expect(optionalNumber(undefined, 'field')).toBe(undefined);
    });

    it('returns number for valid number', () => {
      expect(optionalNumber(42, 'field')).toBe(42);
    });

    it('returns 0 for zero', () => {
      expect(optionalNumber(0, 'field')).toBe(0);
    });

    it('returns negative numbers', () => {
      expect(optionalNumber(-5, 'field')).toBe(-5);
    });

    it('returns floating point numbers', () => {
      expect(optionalNumber(3.14, 'field')).toBe(3.14);
    });

    it('throws for NaN', () => {
      expect(() => optionalNumber(NaN, 'field')).toThrow('field must be a number');
    });

    it('throws for string', () => {
      expect(() => optionalNumber('42', 'field')).toThrow('field must be a number');
    });

    it('throws for null', () => {
      expect(() => optionalNumber(null, 'field')).toThrow('field must be a number');
    });

    it('throws for object', () => {
      expect(() => optionalNumber({}, 'field')).toThrow('field must be a number');
    });

    it('returns Infinity', () => {
      expect(optionalNumber(Infinity, 'field')).toBe(Infinity);
    });

    it('returns negative Infinity', () => {
      expect(optionalNumber(-Infinity, 'field')).toBe(-Infinity);
    });
  });
});
