import { describe, expect, it, vi } from 'vitest';

vi.mock('../llm/profiles', async () => {
  const actual = await vi.importActual<any>('../llm/profiles');
  return {
    ...actual,
    loadProfile: vi.fn(),
  };
});

describe('Agent condensation config', () => {
  it('prefers profile maxInputTokens over settings when profileId is set', async () => {
    const { loadProfile } = await import('../llm/profiles');
    (loadProfile as any).mockReturnValue({
      profileId: 'p1',
      config: {
        provider: 'openai',
        model: 'gpt-5-mini',
        baseUrl: 'http://profile.test/v1',
        maxInputTokens: 100,
      },
    });

    const { getEffectiveLlmConfigForCondensation } = await import('../llm');

    const config = getEffectiveLlmConfigForCondensation({
      llm: { profileId: 'p1', maxInputTokens: 500, model: 'raw-model' },
      agent: {},
      conversation: {},
      confirmation: { policy: 'never' },
      secrets: {},
    });
    expect(config.maxInputTokens).toBe(100);
  });
});
