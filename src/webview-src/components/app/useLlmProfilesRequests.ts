import { useCallback, useRef } from 'react';
import type { LLMConfiguration } from '@openhands/agent-sdk-ts';
import type {
  LlmProfileApiKeyStatusInfo,
  LlmProfileApiKeyStatusOverrides,
  WebviewToHostMessage,
} from '../../../shared/webviewMessages';
import type { PendingLlmProfilesRequest } from './llmProfilesRequests';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

type UseLlmProfilesRequestsOptions = {
  postMessage: (msg: WebviewToHostMessage) => void;
  timeoutMs?: number;
};

export function useLlmProfilesRequests(options: UseLlmProfilesRequestsOptions) {
  const { postMessage, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = options;

  const requestSeqRef = useRef(1);
  const pendingRequestsRef = useRef<Map<string, PendingLlmProfilesRequest>>(new Map());

  const createRequestId = useCallback(
    (kind: string): string => `llmProfiles:${kind}:${requestSeqRef.current++}`,
    [],
  );

  const listLlmProfiles = useCallback(async (): Promise<string[]> => {
    const requestId = createRequestId('list');
    return await new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out listing LLM profiles'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'list', resolve, reject, timeout });
      postMessage({ type: 'llmProfilesListRequest', requestId });
    });
  }, [createRequestId, postMessage, timeoutMs]);

  const loadLlmProfile = useCallback(async (profileId: string): Promise<LLMConfiguration> => {
    const requestId = createRequestId('load');
    return await new Promise<LLMConfiguration>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out loading LLM profile'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'load', resolve, reject, timeout });
      postMessage({ type: 'llmProfileLoadRequest', requestId, profileId });
    });
  }, [createRequestId, postMessage, timeoutMs]);

  const saveLlmProfile = useCallback(async (profileId: string, profile: LLMConfiguration): Promise<void> => {
    const requestId = createRequestId('save');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out saving LLM profile'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'save', resolve, reject, timeout });
      postMessage({ type: 'llmProfileSaveRequest', requestId, profileId, profile });
    });
  }, [createRequestId, postMessage, timeoutMs]);

  const deleteLlmProfile = useCallback(async (profileId: string): Promise<void> => {
    const requestId = createRequestId('delete');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out deleting LLM profile'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'delete', resolve, reject, timeout });
      postMessage({ type: 'llmProfileDeleteRequest', requestId, profileId });
    });
  }, [createRequestId, postMessage, timeoutMs]);

  const getLlmProfileApiKeyStatus = useCallback(async (
    profileId: string,
    overrides?: LlmProfileApiKeyStatusOverrides
  ): Promise<LlmProfileApiKeyStatusInfo> => {
    const requestId = createRequestId('apiKeyStatus');
    return await new Promise<LlmProfileApiKeyStatusInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out fetching LLM profile API key status'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'apiKeyStatus', resolve, reject, timeout });
      const message: WebviewToHostMessage = {
        type: 'llmProfileApiKeyStatusRequest',
        requestId,
        profileId,
        provider: typeof overrides?.provider === 'string' ? overrides.provider : undefined,
        baseUrl: typeof overrides?.baseUrl === 'string' ? overrides.baseUrl : undefined,
      };
      postMessage(message);
    });
  }, [createRequestId, postMessage, timeoutMs]);

  const setLlmProfileApiKey = useCallback(async (profileId: string, apiKey: string): Promise<void> => {
    const requestId = createRequestId('apiKeySet');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        reject(new Error('Timed out setting LLM profile API key'));
      }, timeoutMs);
      pendingRequestsRef.current.set(requestId, { kind: 'apiKeySet', resolve, reject, timeout });
      postMessage({ type: 'llmProfileApiKeySetRequest', requestId, profileId, apiKey });
    });
  }, [createRequestId, postMessage, timeoutMs]);

  return {
    pendingLlmProfilesRequestsRef: pendingRequestsRef,
    listLlmProfiles,
    loadLlmProfile,
    saveLlmProfile,
    deleteLlmProfile,
    getLlmProfileApiKeyStatus,
    setLlmProfileApiKey,
  };
}
