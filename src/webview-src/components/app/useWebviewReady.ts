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

    const sendReady = () => {
      const state = vscodeApi.getState?.<WebviewPersistedState>() ?? {};
      const payload: WebviewToHostMessage = { type: 'webviewReady' };
      if (typeof state.conversationId === 'string') payload.conversationId = state.conversationId;
      if (typeof state.lastSeenSeq === 'number') payload.lastSeenSeq = state.lastSeenSeq;
      postMessage(payload);
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

