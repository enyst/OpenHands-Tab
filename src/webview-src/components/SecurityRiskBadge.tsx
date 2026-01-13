import { Tooltip } from './Tooltip';

export type SecurityRiskLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const RISK_STYLES: Record<SecurityRiskLevel, string> = {
  HIGH: 'bg-red-500/15 text-red-300 border-red-400/30 shadow-[0_0_8px_rgba(248,113,113,0.15)]',
  MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  LOW: 'bg-stone-500/15 text-stone-400 border-stone-400/20',
  UNKNOWN: 'bg-stone-500/15 text-stone-400 border-stone-400/20',
};

const RISK_ICONS: Record<SecurityRiskLevel, string> = {
  HIGH: 'shield',
  MEDIUM: 'warning',
  LOW: 'info',
  UNKNOWN: 'question',
};

export function SecurityRiskBadge({ risk, labelSuffix = '' }: { risk: SecurityRiskLevel; labelSuffix?: string }) {
  const tooltip = `The agent assessed ${risk.toLowerCase()} risk.`;
  const label = `${risk.toLowerCase()}${labelSuffix}`;

  return (
    <Tooltip content={tooltip} position="top">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border cursor-default ${RISK_STYLES[risk]}`}
      >
        <span className={`codicon codicon-${RISK_ICONS[risk]} text-[10px]`} />
        {label}
      </span>
    </Tooltip>
  );
}
