import type { ActionEvent, Event, SecurityRisk } from '../types';
import { isActionEvent } from '../types';

export interface SecurityAnalyzer {
  kind: string;
  securityRisk(action: ActionEvent): SecurityRisk;
  analyzeEvent(event: Event): SecurityRisk | null;
  analyzePendingActions(pendingActions: ActionEvent[]): Array<{ action: ActionEvent; risk: SecurityRisk }>;
}

export class LLMSecurityAnalyzer implements SecurityAnalyzer {
  readonly kind = 'LLMSecurityAnalyzer' as const;

  securityRisk(action: ActionEvent): SecurityRisk {
    return action.security_risk ?? 'UNKNOWN';
  }

  analyzeEvent(event: Event): SecurityRisk | null {
    if (!isActionEvent(event)) return null;
    return this.securityRisk(event);
  }

  analyzePendingActions(pendingActions: ActionEvent[]): Array<{ action: ActionEvent; risk: SecurityRisk }> {
    // Defensive: keep parity with Python analyzers; subclasses may override `securityRisk()` and throw.
    return pendingActions.map((action) => {
      try {
        return { action, risk: this.securityRisk(action) };
      } catch {
        return { action, risk: 'HIGH' };
      }
    });
  }
}
