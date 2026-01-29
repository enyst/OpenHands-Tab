import { useEffect } from 'react';
import { getVscodeApi } from '../../shared/vscodeApi';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';

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
    const e2eMeta = typeof document !== 'undefined'
      ? document.querySelector('meta[name="openhands-e2e"]')
      : null;
    const isE2EEnabled = e2eMeta?.getAttribute('content') === '1';

    const sendReady = () => {
      const state = vscodeApi.getState?.<WebviewPersistedState>() ?? {};
      const payload: WebviewToHostMessage = { type: 'webviewReady' };
      if (typeof state.conversationId === 'string') payload.conversationId = state.conversationId;
      if (typeof state.lastSeenSeq === 'number') payload.lastSeenSeq = state.lastSeenSeq;
      postMessage(payload);
      if (isE2EEnabled && !didSendE2EReady) {
        didSendE2EReady = true;
        postMessage({ type: 'openhandsE2E', event: 'ready' });
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
