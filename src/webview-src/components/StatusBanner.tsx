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
    if (!autoDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissDelay);
    return () => clearTimeout(timer);
  }, [autoDismiss, autoDismissDelay, onDismiss]);

  const levelConfig = {
    info: {
      icon: 'info',
      textColor: 'text-stone-200',
    },
    warn: {
      icon: 'warning',
      textColor: 'text-[var(--brand-primary)]',
    },
    error: {
      icon: 'error',
      textColor: 'text-[var(--event-error)]',
    },
  };

  const config = levelConfig[level];

  return (
    <div
      className={`
        ${config.textColor}
        flex items-center gap-3
        text-sm
        animate-slide-down
      `}
      role="alert"
      aria-live="polite"
    >
      <span
        className={`codicon codicon-${config.icon} flex-shrink-0 ${config.textColor}`}
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
