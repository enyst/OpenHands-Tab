import { LLMFactory, type SecretRegistry } from '@openhands/agent-sdk-ts';
import { normalizeNonEmptyString } from '../shared/stringUtils';
import type { OpenHandsSettings } from '../settings/SettingsManager';

export async function summarizeWithLocalLlm(
  settings: OpenHandsSettings,
  prompt: string,
  secrets: SecretRegistry,
): Promise<string> {
  const profileId = normalizeNonEmptyString(settings.llm.profileId);
  if (!profileId) {
    throw new Error('LLM profileId is not configured');
  }

  const model = normalizeNonEmptyString(settings.llm.model) ?? '';
  const factory = new LLMFactory({
    profileId,
    // LLMFactory loads the effective provider/model/baseUrl/etc from the profile when profileId is set.
    // Keep `model` set to satisfy the type and for error context if the profile load fails.
    model,
  }, {
    secrets,
    preferredApiKeys: [`openhands.llmProfileApiKey.${profileId}`],
  });

  const client = await factory.createClient();
  const request = {
    systemPrompt: 'You are a very good summarizer.',
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
      },
    ],
  };

  let text = '';
  for await (const chunk of client.streamChat(request)) {
    if (chunk.type === 'text') text += chunk.text;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('LLM returned an empty summary');
  }
  return trimmed;
}

