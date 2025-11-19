import { useEffect } from 'react';

interface StatusBannerProps {
  message: string;
  level: 'info' | 'warn' | 'error';
  onDismiss: () => void;
  autoDismiss?: boolean;
  autoDismissDelay?: number;
}

export function StatusBanner({
  message,
  level,
  onDismiss,
  autoDismiss = true,
  autoDismissDelay = 5000,
}: StatusBannerProps) {
  useEffect(() => {
    if (autoDismiss && level !== 'error') {
      const timer = setTimeout(onDismiss, autoDismissDelay);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, autoDismissDelay, level, onDismiss]);

  const levelConfig = {
    info: {
      icon: 'info',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      textColor: 'text-blue-300',
      iconColor: '#3B82F6',
    },
    warn: {
      icon: 'warning',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
      textColor: 'text-yellow-300',
      iconColor: '#EAB308',
    },
    error: {
      icon: 'error',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      textColor: 'text-red-300',
      iconColor: '#DC2626',
    },
  };

  const config = levelConfig[level];

  return (
    <div
      className={`
        ${config.bgColor} ${config.borderColor} ${config.textColor}
        border rounded-lg p-3
        flex items-center gap-3
        animate-slide-down
        shadow-event
      `}
      role="alert"
      aria-live="polite"
    >
      <span
        className={`codicon codicon-${config.icon} flex-shrink-0`}
        style={{ color: config.iconColor }}
      />
      <div className="flex-1 text-sm">{message}</div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center transition-colors"
        aria-label="Dismiss"
      >
        <span className="codicon codicon-close text-xs" />
      </button>
    </div>
  );
}
