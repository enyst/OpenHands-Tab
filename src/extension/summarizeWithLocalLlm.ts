import { LLMFactory, type SecretRegistry } from '@smolpaws/agent-sdk';
import { normalizeNonEmptyString } from '../shared/stringUtils';
import type { OpenHandsSettings } from '../settings/SettingsManager';

export async function summarizeWithLocalLlm(
  settings: OpenHandsSettings,
  prompt: string,
  secrets: SecretRegistry,
): Promise<string> {
  const primaryProfileId = normalizeNonEmptyString(settings.llm.profileId);
  if (!primaryProfileId) throw new Error('LLM profileId is not configured');

  // Prefer the same "fast summarizer" profile used elsewhere, but fall back to the main
  // agent profile when Gemini credentials (or the summarizer profile) are not configured.
  const preferredSummarizerProfileId = 'gemini-flash-summarizer';
  const profileIds: string[] = [];
  for (const id of [preferredSummarizerProfileId, primaryProfileId]) {
    if (!id) continue;
    if (!profileIds.includes(id)) profileIds.push(id);
  }

  const model = normalizeNonEmptyString(settings.llm.model) ?? '';
  let lastError: unknown;
  for (const profileId of profileIds) {
    try {
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
      if (!trimmed) throw new Error('LLM returned an empty summary');
      return trimmed;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
