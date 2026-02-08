import type { LLMConfiguration } from '@smolpaws/agent-sdk';
import type { PendingLlmProfilesRequest } from '../../llmProfilesRequests';
import type { HostMessageHandlerOptions, HostMessageHandlerRegistry } from '../types';

type PendingKind = PendingLlmProfilesRequest['kind'];

function takePendingRequest<K extends PendingKind>(
  requests: Map<string, PendingLlmProfilesRequest>,
  requestId: string,
  kind: K,
): Extract<PendingLlmProfilesRequest, { kind: K }> | null {
  const pending = requests.get(requestId);
  if (!pending || pending.kind !== kind) {
    return null;
  }

  requests.delete(requestId);
  clearTimeout(pending.timeout);
  return pending as Extract<PendingLlmProfilesRequest, { kind: K }>;
}

export function createLlmProfileHandlers(
  options: Pick<HostMessageHandlerOptions, 'pendingLlmProfilesRequestsRef' | 'setLlmProfileId' | 'setLlmProfiles'>,
): HostMessageHandlerRegistry {
  const { pendingLlmProfilesRequestsRef, setLlmProfileId, setLlmProfiles } = options;

  return {
    llmProfilesUpdated: (payload) => {
      if (Array.isArray(payload.profiles)) {
        setLlmProfiles(payload.profiles.filter((id): id is string => typeof id === 'string'));
      }
      if (typeof payload.activeProfileId === 'string' || payload.activeProfileId === null) {
        setLlmProfileId(payload.activeProfileId);
      }
    },

    llmProfilesListResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'list');
      if (!pending) {
        return;
      }

      if (payload.ok === true && Array.isArray(payload.profiles)) {
        pending.resolve(payload.profiles.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to list LLM profiles';
      pending.reject(new Error(reason));
    },

    llmProfileLoadResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'load');
      if (!pending) {
        return;
      }

      if (payload.ok === true && payload.profile && typeof payload.profile === 'object') {
        pending.resolve(payload.profile as LLMConfiguration);
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to load LLM profile';
      pending.reject(new Error(reason));
    },

    llmProfileSaveResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'save');
      if (!pending) {
        return;
      }

      if (payload.ok === true) {
        pending.resolve();
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to save LLM profile';
      pending.reject(new Error(reason));
    },

    llmProfileDeleteResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'delete');
      if (!pending) {
        return;
      }

      if (payload.ok === true) {
        pending.resolve();
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to delete LLM profile';
      pending.reject(new Error(reason));
    },

    llmProfileApiKeyStatusResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'apiKeyStatus');
      if (!pending) {
        return;
      }

      const providerKeyName = typeof payload.providerKeyName === 'string' ? payload.providerKeyName : undefined;
      if (
        payload.ok === true
        && typeof payload.hasKey === 'boolean'
        && typeof payload.hasProfileKey === 'boolean'
        && typeof payload.hasProviderKey === 'boolean'
      ) {
        pending.resolve({
          hasKey: payload.hasKey,
          hasProfileKey: payload.hasProfileKey,
          hasProviderKey: payload.hasProviderKey,
          providerKeyName,
        });
        return;
      }

      if (payload.ok === true && typeof payload.hasKey === 'boolean') {
        pending.resolve({
          hasKey: payload.hasKey,
          hasProfileKey: payload.hasKey,
          hasProviderKey: false,
          providerKeyName,
        });
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to fetch LLM profile API key status';
      pending.reject(new Error(reason));
    },

    llmProfileApiKeySetResponse: (payload) => {
      const requestId = payload.requestId;
      if (typeof requestId !== 'string') {
        return;
      }

      const pending = takePendingRequest(pendingLlmProfilesRequestsRef.current, requestId, 'apiKeySet');
      if (!pending) {
        return;
      }

      if (payload.ok === true) {
        pending.resolve();
        return;
      }

      const reason = typeof payload.error === 'string' ? payload.error : 'Failed to set LLM profile API key';
      pending.reject(new Error(reason));
    },
  };
}
