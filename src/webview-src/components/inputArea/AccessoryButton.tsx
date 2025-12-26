interface AccessoryButtonProps {
  label: string;
  displayLabel?: string;
  icon?: string;
  onClick: () => void;
  badge?: number;
  comingSoon?: boolean;
}

export function AccessoryButton({ icon, label, displayLabel, onClick, badge, comingSoon }: AccessoryButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={comingSoon}
      className={`
        relative inline-flex items-center gap-2
        px-3 py-2 rounded-lg
        text-xs font-medium
        transition-all duration-200
        border
        focus:outline-none focus:ring-1 focus:ring-brand-500/30 focus:ring-offset-0
        ${comingSoon
          ? 'bg-white/[0.02] text-stone-600 border-white/[0.03] cursor-not-allowed'
          : 'bg-white/[0.04] text-stone-400 border-white/[0.06] hover:bg-white/[0.08] hover:text-stone-300 hover:border-white/[0.1]'
        }
      `}
      aria-label={label}
      title={label}
    >
      {icon && <span className={`codicon codicon-${icon}`} />}
      <span>{displayLabel ?? label}</span>

      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white text-[10px] font-semibold flex items-center justify-center shadow-glow-sm">
          {badge}
        </span>
      )}

      {comingSoon && (
        <span className="text-[10px] text-stone-600 italic">soon</span>
      )}
    </button>
  );
}

