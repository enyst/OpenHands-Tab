import { describe, expect, it } from 'vitest';
import { getWelcomePromptFlags } from '../components/app/welcomePrompts';

describe('welcome prompts display logic', () => {
  it('shows both messages when no provider key and no gemini key', () => {
    const flags = getWelcomePromptFlags({ hasProviderKey: false, hasGeminiKey: false });
    expect(flags.showProviderKeyMessage).toBe(true);
    expect(flags.showGeminiKeyMessage).toBe(true);
  });

  it('hides provider-key message but shows gemini message when provider key exists but gemini missing', () => {
    const flags = getWelcomePromptFlags({ hasProviderKey: true, hasGeminiKey: false });
    expect(flags.showProviderKeyMessage).toBe(false);
    expect(flags.showGeminiKeyMessage).toBe(true);
  });

  it('hides both messages when gemini key is set', () => {
    const flags = getWelcomePromptFlags({ hasProviderKey: true, hasGeminiKey: true });
    expect(flags.showProviderKeyMessage).toBe(false);
    expect(flags.showGeminiKeyMessage).toBe(false);
  });

  it('treats gemini key as a provider key (never show provider-key message when gemini is set)', () => {
    const flags = getWelcomePromptFlags({ hasProviderKey: false, hasGeminiKey: true });
    expect(flags.showProviderKeyMessage).toBe(false);
    expect(flags.showGeminiKeyMessage).toBe(false);
  });
});

