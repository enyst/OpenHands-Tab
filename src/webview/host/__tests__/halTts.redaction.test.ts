import { describe, expect, it, vi } from 'vitest';
import { handleHalTtsRequest } from '../handlers/hal';

describe('handleHalTtsRequest', () => {
  it('redacts the ElevenLabs API key from error messages', async () => {
    const postMessage = vi.fn(async () => true);
    const settingsMgr = {
      get: vi.fn(async () => ({
        hal: {
          userName: 'Engel',
          mode: 'tts_only',
          voiceAId: 'voice_hal',
          voiceUserId: 'voice_user',
          modelId: 'eleven_turbo_v2',
          volume: 1,
          cache: true,
        },
        secrets: { halTtsApiKey: 'eleven-secret' },
      })),
    };
    const gate = {
      synthesize: vi.fn(async () => ({
        ok: false as const,
        error: 'invalid key eleven-secret',
        kind: 'auth' as const,
        disabled: true,
        shouldNotify: true,
      })),
    };

    await handleHalTtsRequest({
      deps: { secretRegistry: { getRegisteredValues: () => [] } } as any,
      host: { postMessage },
      settingsMgr: settingsMgr as any,
      getElevenlabsTtsGate: () => gate as any,
      message: { type: 'halTtsRequest', requestId: 'r1', conversationId: 'c1', stepIndex: 0 },
    });

    const response = postMessage.mock.calls
      .map((call) => call[0])
      .find((payload) => payload?.type === 'halTtsResponse');

    expect(response).toBeTruthy();
    expect(response?.ok).toBe(false);
    expect(response?.error).toContain('[REDACTED]');
    expect(response?.error).not.toContain('eleven-secret');
  });
});
