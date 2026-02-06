import type * as vscode from 'vscode';
import { detectProviderFromBaseUrl, type LLMProvider } from '@openhands/agent-sdk-ts';
import { type WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { CreateWebviewMessageHandlerDeps, WebviewHost } from '../webviewMessageHandler.types';
import * as llmProfilesStore from '../llmProfilesStore';
import { createStoredSecretHelpers, getProviderApiKeyName, isLlmProvider } from './secretHelpers';
import { getProfileApiKeySecretKey, llmProfileStoreOptions } from './llmProfiles.shared';

export async function handleLlmProfileApiKeyStatusRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  context: vscode.ExtensionContext;
  message: Extract<WebviewToHostMessage, { type: 'llmProfileApiKeyStatusRequest' }>;
}): Promise<void> {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  if (!requestId || !profileId) return;

  const { hasStoredSecret } = createStoredSecretHelpers({ context: args.context, secretRegistry: args.deps.secretRegistry });

  try {
    const key = getProfileApiKeySecretKey(profileId);
    const stored = await args.context.secrets.get(key);
    const hasProfileKey = typeof stored === 'string' && stored.trim().length > 0;
    const overrideProviderRaw = typeof args.message.provider === 'string' ? args.message.provider.trim() : '';
    const overrideProvider = overrideProviderRaw && isLlmProvider(overrideProviderRaw) ? overrideProviderRaw : null;
    const overrideBaseUrl = typeof args.message.baseUrl === 'string' ? args.message.baseUrl.trim() : '';

    // Prefer explicit provider/baseUrl overrides so we can check provider keys even for
    // draft/new profiles that do not exist yet on disk.
    const provider: LLMProvider = (() => {
      if (overrideProvider) return overrideProvider;
      if (overrideBaseUrl) return detectProviderFromBaseUrl(overrideBaseUrl);

      const profile = llmProfilesStore.loadProfile(profileId, llmProfileStoreOptions(args.deps));
      return profile.config.provider ?? detectProviderFromBaseUrl(profile.config.baseUrl);
    })();
    const providerKeyName = getProviderApiKeyName(provider);
    const hasProviderKey = await hasStoredSecret(providerKeyName);
    void args.host.postMessage({
      type: 'llmProfileApiKeyStatusResponse',
      requestId,
      ok: true,
      profileId,
      hasKey: hasProfileKey || hasProviderKey,
      hasProfileKey,
      hasProviderKey,
      providerKeyName,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfileApiKeyStatusResponse', requestId, ok: false, profileId, error: reason });
  }
}

export async function handleLlmProfileApiKeySetRequest(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  context: vscode.ExtensionContext;
  message: Extract<WebviewToHostMessage, { type: 'llmProfileApiKeySetRequest' }>;
}): Promise<void> {
  const requestId = typeof args.message.requestId === 'string' ? args.message.requestId.trim() : '';
  const profileId = typeof args.message.profileId === 'string' ? args.message.profileId.trim() : '';
  const apiKey = typeof args.message.apiKey === 'string' ? args.message.apiKey.trim() : '';
  if (!requestId || !profileId) return;

  try {
    const key = getProfileApiKeySecretKey(profileId);
    if (!apiKey) {
      await args.context.secrets.delete(key);
      args.deps.secretRegistry?.set(key, undefined);
    } else {
      await args.context.secrets.store(key, apiKey);
      args.deps.secretRegistry?.set(key, apiKey);
    }
    void args.host.postMessage({ type: 'llmProfileApiKeySetResponse', requestId, ok: true, profileId });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void args.host.postMessage({ type: 'llmProfileApiKeySetResponse', requestId, ok: false, profileId, error: reason });
  }
}
