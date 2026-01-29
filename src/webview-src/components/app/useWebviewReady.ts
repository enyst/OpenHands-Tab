import { useEffect } from 'react';
import { getVscodeApi } from '../../shared/vscodeApi';
import type { WebviewE2EInfo, WebviewToHostMessage } from '../../../shared/webviewMessages';

type WebviewPersistedState = {
  conversationId?: string;
  lastSeenSeq?: number;
};

export function useWebviewReady({ postMessage }: { postMessage: (message: WebviewToHostMessage) => void }) {
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    let didRequestSkills = false;
    let didRequestTools = false;
    let didSendE2EReady = false;
    let e2ePayload: WebviewE2EInfo | undefined;
    const e2eMeta = typeof document !== 'undefined'
      ? document.querySelector('meta[name="openhands-e2e"]')
      : null;
    const isE2EEnabled = e2eMeta?.getAttribute('content') === '1';

    if (isE2EEnabled && typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const extensionId = url.searchParams.get('extensionId') ?? undefined;
        e2ePayload = {
          host: url.host,
          pathname: url.pathname,
          extensionId,
          title: document.title || undefined,
        };
      } catch {
        e2ePayload = undefined;
      }
    }

    const sendReady = () => {
      const state = vscodeApi.getState?.<WebviewPersistedState>() ?? {};
      const payload: WebviewToHostMessage = { type: 'webviewReady' };
      if (typeof state.conversationId === 'string') payload.conversationId = state.conversationId;
      if (typeof state.lastSeenSeq === 'number') payload.lastSeenSeq = state.lastSeenSeq;
      postMessage(payload);
      if (isE2EEnabled && !didSendE2EReady) {
        didSendE2EReady = true;
        postMessage({ type: 'openhandsE2E', event: 'ready', payload: e2ePayload });
      }
      if (!didRequestSkills) {
        didRequestSkills = true;
        postMessage({ type: 'requestSkills' });
      }
      if (!didRequestTools) {
        didRequestTools = true;
        postMessage({ type: 'requestTools' });
      }
    };

    sendReady();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendReady();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [postMessage]);
}
