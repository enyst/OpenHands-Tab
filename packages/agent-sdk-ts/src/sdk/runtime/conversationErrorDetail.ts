import { DEFAULT_PROVIDER_BASE_URLS, detectProviderFromBaseUrl, loadProfile } from '../llm';
import type { OpenHandsSettings } from '../types/settings';
import { isSafeProfileId, toOptionalNonEmptyString } from './settingsUtils';

type BuildConversationErrorDetailParams = {
  message: string;
  debug: boolean;
  settings: OpenHandsSettings | undefined;
};

export function buildConversationErrorDetail(params: BuildConversationErrorDetailParams): string {
  const { message, debug, settings } = params;
  if (!debug) return message;

  const model = toOptionalNonEmptyString(settings?.llm?.model);
  const profileId = toOptionalNonEmptyString(settings?.llm?.profileId);
  const configuredBaseUrl = toOptionalNonEmptyString(settings?.llm?.baseUrl);
  const configuredProvider = settings?.llm?.provider ?? undefined;
  const provider = configuredProvider ?? detectProviderFromBaseUrl(configuredBaseUrl);
  const effectiveBaseUrl = configuredBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[provider] ?? DEFAULT_PROVIDER_BASE_URLS.openai;
  const configuredApiKey = toOptionalNonEmptyString(settings?.secrets?.llmApiKey);
  const apiKeyStatus = configuredApiKey ? 'set' : 'unset';
  const mode = settings?.serverUrl ? 'remote' : 'local';
  const serverUrl = toOptionalNonEmptyString(settings?.serverUrl);

  const contextParts = [
    `mode=${mode}`,
    `llm.model=${model ?? '(unset)'}`,
    `llm.provider=${provider}`,
    `llm.baseUrl=${configuredBaseUrl ?? '(default)'}`,
    `llm.effectiveBaseUrl=${effectiveBaseUrl}`,
    `llm.apiKeyStatus=${apiKeyStatus}`,
  ];
  if (profileId) {
    contextParts.push(`llm.profileId=${profileId}`);

    if (isSafeProfileId(profileId)) {
      try {
        const profile = loadProfile(profileId);
        const profileModel = toOptionalNonEmptyString(profile.config.model);
        const profileBaseUrl = toOptionalNonEmptyString(profile.config.baseUrl);
        const effectiveProfileProvider =
          profile.config.provider ?? detectProviderFromBaseUrl(profileBaseUrl ?? configuredBaseUrl);
        contextParts.push(`llm.effectiveProvider=${effectiveProfileProvider}`);
        contextParts.push(`llm.effectiveModel=${profileModel ?? '(unset)'}`);
      } catch {
        // best-effort: profile may be missing or unreadable
      }
    }
  }
  if (serverUrl) contextParts.push(`serverUrl=${serverUrl}`);

  return `${message} (${contextParts.join(', ')})`;
}
