import type * as vscode from 'vscode';
import type { LLMProvider, SecretRegistry } from '@openhands/agent-sdk-ts';

export const isLlmProvider = (value: string): value is LLMProvider => {
  return value === 'openai'
    || value === 'litellm_proxy'
    || value === 'openrouter'
    || value === 'anthropic'
    || value === 'gemini';
};

export const getProviderApiKeyName = (provider: LLMProvider): string => {
  switch (provider) {
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'litellm_proxy':
      return 'LITELLM_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'gemini':
      return 'GEMINI_API_KEY';
    default:
      return 'OPENAI_API_KEY';
  }
};

export const createStoredSecretHelpers = (args: {
  context: vscode.ExtensionContext;
  secretRegistry?: SecretRegistry;
}): {
  getStoredSecret: (key: string) => Promise<string | undefined>;
  hasStoredSecret: (key: string) => Promise<boolean>;
} => {
  const getStoredSecret = async (key: string): Promise<string | undefined> => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return undefined;
    try {
      let resolved = args.secretRegistry ? await args.secretRegistry.get(trimmedKey) : undefined;
      if (!resolved) {
        resolved = await args.context.secrets.get(trimmedKey);
        if (!resolved) {
          resolved = process.env[trimmedKey];
        }
      }
      const trimmedValue = typeof resolved === 'string' ? resolved.trim() : '';
      return trimmedValue || undefined;
    } catch {
      return undefined;
    }
  };

  const hasStoredSecret = async (key: string): Promise<boolean> => {
    return Boolean(await getStoredSecret(key));
  };

  return { getStoredSecret, hasStoredSecret };
};
