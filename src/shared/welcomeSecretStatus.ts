import type * as vscode from 'vscode';
import { listProfiles } from '@smolpaws/agent-sdk';
import type { OpenHandsSettings } from './settingsTypes';

const PROVIDER_STORAGE_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'LITELLM_API_KEY',
] as const;

export async function computeWelcomeSecretStatus(args: {
  context: vscode.ExtensionContext;
  settings: OpenHandsSettings;
}): Promise<{ hasProviderKey: boolean; hasGeminiKey: boolean }> {
  const secretIsSet = async (key: string): Promise<boolean> => {
    try {
      const value = await args.context.secrets.get(key);
      return typeof value === 'string' && value.trim().length > 0;
    } catch {
      return false;
    }
  };

  const envIsSet = (key: string): boolean => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  };

  const hasGeminiKey =
    (await secretIsSet('GEMINI_API_KEY')) ||
    envIsSet('GEMINI_API_KEY') ||
    (args.settings.llm.provider === 'gemini' &&
      typeof args.settings.secrets.llmApiKey === 'string' &&
      args.settings.secrets.llmApiKey.trim().length > 0);

  const hasGenericKey =
    typeof args.settings.secrets.llmApiKey === 'string' && args.settings.secrets.llmApiKey.trim().length > 0;

  let hasAnyProviderStorageKey = false;
  for (const key of PROVIDER_STORAGE_KEYS) {
    if (envIsSet(key) || (await secretIsSet(key))) {
      hasAnyProviderStorageKey = true;
      break;
    }
  }

  let hasAnyProfileKey = false;
  try {
    for (const profileId of listProfiles()) {
      if (await secretIsSet(`openhands.llmProfileApiKey.${profileId}`)) {
        hasAnyProfileKey = true;
        break;
      }
    }
  } catch {
    hasAnyProfileKey = false;
  }

  const hasProviderKey = hasGeminiKey || hasGenericKey || hasAnyProviderStorageKey || hasAnyProfileKey;
  return { hasProviderKey, hasGeminiKey };
}
