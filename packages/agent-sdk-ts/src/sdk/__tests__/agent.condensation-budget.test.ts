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

    const { Agent, ConversationState, EventLog } = await import('../runtime');
    const events = new EventLog();
    const state = new ConversationState({ eventLog: events });

    const agent = new Agent({
      settings: {
        llm: { profileId: 'p1', maxInputTokens: 500, model: 'raw-model' },
        agent: {},
        conversation: {},
        confirmation: { policy: 'never' },
        secrets: {},
      },
      events,
      state,
      tools: [],
    });

    const config = (agent as any).getEffectiveLlmConfigForCondensation();
    expect(config.maxInputTokens).toBe(100);
  });
});
