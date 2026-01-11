import type { ConfirmationSettings } from '../types/settings';
import type { SecurityRisk } from '../types';

const SECURITY_RISK_ORDER: Array<Exclude<SecurityRisk, 'UNKNOWN'>> = ['LOW', 'MEDIUM', 'HIGH'];

export interface ConfirmationPolicy {
  kind: 'AlwaysConfirm' | 'NeverConfirm' | 'ConfirmRisky';
  shouldConfirm(risk?: SecurityRisk): boolean;
}

export class AlwaysConfirm implements ConfirmationPolicy {
  readonly kind = 'AlwaysConfirm' as const;

  shouldConfirm(_risk: SecurityRisk = 'UNKNOWN'): boolean {
    return true;
  }
}

export class NeverConfirm implements ConfirmationPolicy {
  readonly kind = 'NeverConfirm' as const;

  shouldConfirm(_risk: SecurityRisk = 'UNKNOWN'): boolean {
    return false;
  }
}

export class ConfirmRisky implements ConfirmationPolicy {
  readonly kind = 'ConfirmRisky' as const;
  readonly threshold: Exclude<SecurityRisk, 'UNKNOWN'>;
  readonly confirmUnknown: boolean;

  constructor(options?: { threshold?: Exclude<SecurityRisk, 'UNKNOWN'>; confirmUnknown?: boolean }) {
    const threshold = options?.threshold ?? 'HIGH';
    if (!SECURITY_RISK_ORDER.includes(threshold)) {
      throw new Error('ConfirmRisky.threshold cannot be UNKNOWN.');
    }
    this.threshold = threshold;
    this.confirmUnknown = options?.confirmUnknown ?? true;
  }

  shouldConfirm(risk: SecurityRisk = 'UNKNOWN'): boolean {
    if (risk === 'UNKNOWN') return this.confirmUnknown;
    return SECURITY_RISK_ORDER.indexOf(risk) >= SECURITY_RISK_ORDER.indexOf(this.threshold);
  }
}

export const createConfirmationPolicyFromSettings = (settings?: ConfirmationSettings): ConfirmationPolicy => {
  const policy = settings?.policy ?? 'never';
  if (policy === 'always') return new AlwaysConfirm();
  if (policy === 'risky') {
    const threshold = (settings?.riskyThreshold?.toUpperCase() as Exclude<SecurityRisk, 'UNKNOWN'> | undefined) ?? 'MEDIUM';
    const confirmUnknown = settings?.confirmUnknown ?? true;
    return new ConfirmRisky({ threshold, confirmUnknown });
  }
  return new NeverConfirm();
};

