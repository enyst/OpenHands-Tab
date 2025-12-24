import { useCallback, useRef, useState } from 'react';

export type StatusBannerState = {
  message: string;
  level: 'info' | 'warn' | 'error';
  dismissible?: boolean;
  autoDismiss?: boolean;
  autoDismissDelay?: number;
};

export type ShowStatusMessage = (
  level: 'info' | 'warn' | 'error',
  message: string,
  options?: { autoDismiss?: boolean; autoDismissDelay?: number }
) => void;

const STATUS_DEBOUNCE_MS = 600;

export function useStatusMessages(initial: StatusBannerState | null) {
  const [statusBanner, setStatusBanner] = useState<StatusBannerState | null>(initial);
  const lastStatusMessageRef = useRef<{ level: 'info' | 'warn' | 'error'; message: string; at: number }>(
    { level: 'info', message: '', at: 0 }
  );

  const showStatusMessage: ShowStatusMessage = useCallback((level, message, options) => {
    const now = Date.now();
    const prev = lastStatusMessageRef.current;
    if (prev.level === level && prev.message === message && now - prev.at < STATUS_DEBOUNCE_MS) {
      return;
    }
    lastStatusMessageRef.current = { level, message, at: now };
    setStatusBanner({ message, level, autoDismiss: options?.autoDismiss, autoDismissDelay: options?.autoDismissDelay });
  }, []);

  return { statusBanner, setStatusBanner, showStatusMessage };
}

