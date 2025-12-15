import { useEffect } from 'react';

interface StatusBannerProps {
  message: string;
  level: 'info' | 'warn' | 'error';
  onDismiss: () => void;
  dismissible?: boolean;
  autoDismiss?: boolean;
  autoDismissDelay?: number;
}

export function StatusBanner({
  message,
  level,
  onDismiss,
  dismissible = true,
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
      bgColor: 'bg-brand-500/10',
      borderColor: 'border-brand-500/20',
      textColor: 'text-brand-200',
      iconColor: '#E8A642',
    },
    warn: {
      icon: 'warning',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      textColor: 'text-amber-200',
      iconColor: '#FBBF24',
    },
    error: {
      icon: 'error',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-400/20',
      textColor: 'text-red-200',
      iconColor: '#F87171',
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
      <div
        className={`flex-1 text-sm ${level === 'error' ? 'break-words' : 'truncate'}`}
        title={message}
      >
        {message}
      </div>
      {dismissible && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 w-6 h-6 rounded-md hover:bg-white/[0.08] flex items-center justify-center transition-colors text-stone-400 hover:text-stone-300"
          aria-label="Dismiss"
        >
          <span className="codicon codicon-close text-xs" />
        </button>
      )}
    </div>
  );
}
