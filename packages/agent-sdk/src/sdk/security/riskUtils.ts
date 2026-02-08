import type { SecurityRisk } from '../types';

const VALID_SECURITY_RISKS: SecurityRisk[] = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'];

export function normalizeSecurityRisk(risk?: SecurityRisk): SecurityRisk {
  if (!risk) return 'UNKNOWN';
  return VALID_SECURITY_RISKS.includes(risk) ? risk : 'HIGH';
}
