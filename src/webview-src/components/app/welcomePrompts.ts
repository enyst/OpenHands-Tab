export type WelcomeSecretStatus = { hasProviderKey: boolean; hasGeminiKey: boolean };

export function getWelcomePromptFlags(status: WelcomeSecretStatus | null | undefined): {
  hasProviderKey: boolean;
  hasGeminiKey: boolean;
  showProviderKeyMessage: boolean;
  showGeminiKeyMessage: boolean;
} {
  const hasGeminiKey = status?.hasGeminiKey === true;
  // Treat Gemini as a valid "provider key" even if callers provide inconsistent flags.
  const hasProviderKey = (status?.hasProviderKey === true) || hasGeminiKey;

  return {
    hasProviderKey,
    hasGeminiKey,
    showProviderKeyMessage: !hasProviderKey,
    showGeminiKeyMessage: !hasGeminiKey,
  };
}
