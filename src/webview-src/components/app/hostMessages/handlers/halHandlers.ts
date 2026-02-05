import type { HostMessageHandlerOptions, HostMessageHandlerRegistry } from '../types';

export function createHalHandlers(
  options: Pick<HostMessageHandlerOptions,
    | 'applyHalSettings'
    | 'currentServerUrlRef'
    | 'halStateRef'
    | 'handleHalTeleportCanceled'
    | 'handleHalTeleportFailed'
    | 'handleHalTeleportStarting'
    | 'handleHalTeleportSuccess'
    | 'handleHalTeleportUnavailable'
    | 'handleHalTtsResponse'
    | 'handleHalVoiceConfirmResponse'
    | 'postMessage'
    | 'setCurrentServerUrl'>,
): HostMessageHandlerRegistry {
  const {
    applyHalSettings,
    currentServerUrlRef,
    halStateRef,
    handleHalTeleportCanceled,
    handleHalTeleportFailed,
    handleHalTeleportStarting,
    handleHalTeleportSuccess,
    handleHalTeleportUnavailable,
    handleHalTtsResponse,
    handleHalVoiceConfirmResponse,
    postMessage,
    setCurrentServerUrl,
  } = options;

  return {
    halSettings: (payload) => {
      applyHalSettings(payload.hal);
    },

    halTtsResponse: (payload) => {
      handleHalTtsResponse(payload as Record<string, unknown>);
    },

    halVoiceConfirmResponse: (payload) => {
      handleHalVoiceConfirmResponse(payload as Record<string, unknown>);
    },

    halTeleportUnavailable: (payload) => {
      handleHalTeleportUnavailable(payload.error);
    },

    halTeleportFailed: (payload) => {
      const serverUrl = typeof payload.serverUrl === 'string' ? payload.serverUrl : undefined;
      handleHalTeleportFailed(payload.error, serverUrl);
    },

    halTeleportStarting: (payload) => {
      if (typeof payload.serverUrl === 'string') {
        handleHalTeleportStarting(payload.serverUrl, payload.serverLabel);
      }
    },

    halTeleportCanceled: () => {
      handleHalTeleportCanceled();
    },

    halTeleportSuccess: (payload) => {
      if (typeof payload.serverUrl === 'string') {
        currentServerUrlRef.current = payload.serverUrl;
        setCurrentServerUrl(payload.serverUrl);
        handleHalTeleportSuccess(payload.serverUrl, payload.serverLabel);
      }
    },

    queryHalState: (payload) => {
      if (typeof payload.requestId === 'string') {
        postMessage({ type: 'halStateResponse', requestId: payload.requestId, ...halStateRef.current });
      }
    },
  };
}
