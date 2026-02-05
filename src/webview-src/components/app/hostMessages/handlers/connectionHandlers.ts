import type { RefObject } from 'react';
import type { HostMessageHandlerOptions, HostMessageHandlerRegistry } from '../types';
import type { StatusBannerState } from '../../useStatusMessages';

export function createConnectionHandlers(args: {
  options: HostMessageHandlerOptions;
  lastModeRef: RefObject<'local' | 'remote' | null>;
}): HostMessageHandlerRegistry {
  const { options, lastModeRef } = args;
  const {
    currentServerUrlRef,
    postMessage,
    setCurrentServerUrl,
    setMode,
    setServers,
    setStatus,
    setStatusBanner,
    setWelcomeSecretStatus,
    showStatusMessage,
  } = options;

  return {
    status: (payload) => {
      if (!payload.status) {
        return;
      }

      setStatus(payload.status);
      if (payload.mode === 'local' || payload.mode === 'remote') {
        setMode(payload.mode);
        if (payload.mode === 'local' && lastModeRef.current !== 'local') {
          lastModeRef.current = 'local';
          postMessage({ type: 'requestTools' });
        } else if (payload.mode === 'remote' && lastModeRef.current !== 'remote') {
          lastModeRef.current = 'remote';
        }
      }

      const nextBanner: StatusBannerState | null =
        payload.mode === 'local'
          ? { message: 'Local mode: running without remote server', level: 'info', dismissible: false }
          : payload.status === 'connecting'
            ? { message: 'Connecting to server…', level: 'info' }
            : payload.status === 'online'
              ? { message: 'Connected to server', level: 'info' }
              : payload.status === 'offline'
                ? { message: 'Disconnected from server', level: 'warn' }
                : null;

      if (!nextBanner) {
        return;
      }

      setStatusBanner((prev) => {
        if (!prev) {
          return nextBanner;
        }
        if (
          prev.message === nextBanner.message
          && prev.level === nextBanner.level
          && prev.dismissible === nextBanner.dismissible
        ) {
          return prev;
        }
        return nextBanner;
      });
    },

    welcomeSecretStatus: (payload) => {
      const hasProviderKey = payload.hasProviderKey === true;
      const hasGeminiKey = payload.hasGeminiKey === true;
      setWelcomeSecretStatus({ hasProviderKey, hasGeminiKey });
    },

    statusMessage: (payload) => {
      const level = payload.level;
      const message = payload.message;
      if ((level === 'info' || level === 'warn' || level === 'error') && typeof message === 'string' && message.trim()) {
        const autoDismiss = payload.autoDismiss === true;
        const autoDismissDelay = typeof payload.autoDismissDelay === 'number' && Number.isFinite(payload.autoDismissDelay)
          ? Math.max(0, payload.autoDismissDelay)
          : undefined;
        showStatusMessage(level, message.trim(), { autoDismiss, autoDismissDelay });
      }
    },

    config: (payload) => {
      const url = typeof payload.serverUrl === 'string' ? payload.serverUrl : null;
      const nextUrl = url ? url : undefined;

      if (payload.mode === 'local') {
        lastModeRef.current = 'local';
        setMode('local');
        currentServerUrlRef.current = undefined;
        setCurrentServerUrl(undefined);
        setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
        postMessage({ type: 'requestTools' });
        return;
      }

      if (payload.mode === 'remote') {
        lastModeRef.current = 'remote';
        setMode('remote');
        currentServerUrlRef.current = nextUrl;
        setCurrentServerUrl(nextUrl);
        return;
      }

      currentServerUrlRef.current = nextUrl;
      setCurrentServerUrl(nextUrl);
    },

    configUpdated: (payload) => {
      if (typeof payload.serverUrl === 'string' || payload.serverUrl === null) {
        const url = payload.serverUrl || undefined;
        setCurrentServerUrl(url);
        const label = url || 'local mode';
        showStatusMessage('info', `Config updated: ${label}`);
      }
      if (payload.mode === 'local') {
        setMode('local');
        setCurrentServerUrl(undefined);
        setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
      } else if (payload.mode === 'remote') {
        setMode('remote');
      }
    },

    serverListUpdated: (payload) => {
      if (Array.isArray(payload.servers)) {
        setServers(payload.servers);
      }
      if (typeof payload.serverUrl === 'string') {
        const nextUrl = payload.serverUrl || undefined;
        currentServerUrlRef.current = nextUrl;
        setCurrentServerUrl(nextUrl);
      }
    },

    error: (payload) => {
      if (typeof payload.error === 'string') {
        setStatusBanner({ message: payload.error, level: 'error' });
      } else {
        setStatusBanner({ message: 'An unknown error occurred', level: 'error' });
      }
    },
  };
}
