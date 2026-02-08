import { describe, it, expect } from 'vitest';
import {
  AlwaysConfirm,
  NeverConfirm,
  ConfirmRisky,
  createConfirmationPolicyFromSettings,
} from '../confirmationPolicy';
import type { SecurityRisk } from '../../types';

describe('AlwaysConfirm', () => {
  it('always returns true regardless of risk level', () => {
    const policy = new AlwaysConfirm();
    expect(policy.shouldConfirm('LOW')).toBe(true);
    expect(policy.shouldConfirm('MEDIUM')).toBe(true);
    expect(policy.shouldConfirm('HIGH')).toBe(true);
    expect(policy.shouldConfirm('UNKNOWN')).toBe(true);
    expect(policy.shouldConfirm()).toBe(true);
  });

  it('has kind AlwaysConfirm', () => {
    const policy = new AlwaysConfirm();
    expect(policy.kind).toBe('AlwaysConfirm');
  });
});

describe('NeverConfirm', () => {
  it('always returns false regardless of risk level', () => {
    const policy = new NeverConfirm();
    expect(policy.shouldConfirm('LOW')).toBe(false);
    expect(policy.shouldConfirm('MEDIUM')).toBe(false);
    expect(policy.shouldConfirm('HIGH')).toBe(false);
    expect(policy.shouldConfirm('UNKNOWN')).toBe(false);
    expect(policy.shouldConfirm()).toBe(false);
  });

  it('has kind NeverConfirm', () => {
    const policy = new NeverConfirm();
    expect(policy.kind).toBe('NeverConfirm');
  });
});

describe('ConfirmRisky', () => {
  describe('with default threshold (HIGH)', () => {
    it('confirms only HIGH risk', () => {
      const policy = new ConfirmRisky();
      expect(policy.shouldConfirm('LOW')).toBe(false);
      expect(policy.shouldConfirm('MEDIUM')).toBe(false);
      expect(policy.shouldConfirm('HIGH')).toBe(true);
    });

    it('confirms UNKNOWN by default', () => {
      const policy = new ConfirmRisky();
      expect(policy.shouldConfirm('UNKNOWN')).toBe(true);
      expect(policy.shouldConfirm()).toBe(true);
    });
  });

  describe('with MEDIUM threshold', () => {
    it('confirms MEDIUM and HIGH', () => {
      const policy = new ConfirmRisky({ threshold: 'MEDIUM' });
      expect(policy.shouldConfirm('LOW')).toBe(false);
      expect(policy.shouldConfirm('MEDIUM')).toBe(true);
      expect(policy.shouldConfirm('HIGH')).toBe(true);
    });
  });

  describe('with LOW threshold', () => {
    it('confirms LOW, MEDIUM, and HIGH', () => {
      const policy = new ConfirmRisky({ threshold: 'LOW' });
      expect(policy.shouldConfirm('LOW')).toBe(true);
      expect(policy.shouldConfirm('MEDIUM')).toBe(true);
      expect(policy.shouldConfirm('HIGH')).toBe(true);
    });
  });

  describe('confirmUnknown option', () => {
    it('does not confirm UNKNOWN when confirmUnknown is false', () => {
      const policy = new ConfirmRisky({ confirmUnknown: false });
      expect(policy.shouldConfirm('UNKNOWN')).toBe(false);
      expect(policy.shouldConfirm()).toBe(false);
    });

    it('confirms UNKNOWN when confirmUnknown is true', () => {
      const policy = new ConfirmRisky({ confirmUnknown: true });
      expect(policy.shouldConfirm('UNKNOWN')).toBe(true);
    });
  });

  it('treats invalid risk values as HIGH', () => {
    const policy = new ConfirmRisky({ threshold: 'MEDIUM', confirmUnknown: false });
    expect(policy.shouldConfirm('CRITICAL' as unknown as SecurityRisk)).toBe(true);
  });

  it('has kind ConfirmRisky', () => {
    const policy = new ConfirmRisky();
    expect(policy.kind).toBe('ConfirmRisky');
  });

  it('exposes threshold and confirmUnknown properties', () => {
    const policy = new ConfirmRisky({ threshold: 'MEDIUM', confirmUnknown: false });
    expect(policy.threshold).toBe('MEDIUM');
    expect(policy.confirmUnknown).toBe(false);
  });
});

describe('createConfirmationPolicyFromSettings', () => {
  it('returns NeverConfirm for undefined settings', () => {
    const policy = createConfirmationPolicyFromSettings(undefined);
    expect(policy.kind).toBe('NeverConfirm');
  });

  it('returns NeverConfirm for policy: never', () => {
    const policy = createConfirmationPolicyFromSettings({ policy: 'never' });
    expect(policy.kind).toBe('NeverConfirm');
  });

  it('returns AlwaysConfirm for policy: always', () => {
    const policy = createConfirmationPolicyFromSettings({ policy: 'always' });
    expect(policy.kind).toBe('AlwaysConfirm');
  });

  it('returns ConfirmRisky for policy: risky', () => {
    const policy = createConfirmationPolicyFromSettings({ policy: 'risky' });
    expect(policy.kind).toBe('ConfirmRisky');
  });

  it('applies riskyThreshold from settings', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
      riskyThreshold: 'low',
    }) as ConfirmRisky;
    expect(policy.threshold).toBe('LOW');
  });

  it('applies uppercase riskyThreshold from settings', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
      riskyThreshold: 'MEDIUM',
    }) as ConfirmRisky;
    expect(policy.threshold).toBe('MEDIUM');
  });

  it('applies confirmUnknown from settings', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
      confirmUnknown: false,
    }) as ConfirmRisky;
    expect(policy.confirmUnknown).toBe(false);
  });

  it('defaults riskyThreshold to MEDIUM', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
    }) as ConfirmRisky;
    expect(policy.threshold).toBe('MEDIUM');
  });

  it('defaults confirmUnknown to true', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
    }) as ConfirmRisky;
    expect(policy.confirmUnknown).toBe(true);
  });

  it('returns NeverConfirm when policy is undefined', () => {
    const policy = createConfirmationPolicyFromSettings({});
    expect(policy.kind).toBe('NeverConfirm');
  });
});
