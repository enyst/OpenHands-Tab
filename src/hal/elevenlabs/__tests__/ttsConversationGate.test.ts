import { describe, expect, it, vi } from 'vitest';
import type { ElevenLabsTtsService } from '../ttsService';
import { ElevenLabsError } from '../ttsClient';
import { TtsConversationGate } from '../ttsConversationGate';

describe('TtsConversationGate', () => {
  it('disables HAL audio per conversation after first failure and notifies once', async () => {
    const tts = {
      synthesize: vi.fn(async () => {
        throw new ElevenLabsError('Nope', { kind: 'auth', status: 401 });
      }),
    } as unknown as ElevenLabsTtsService;
    const gate = new TtsConversationGate(tts);

    const first = await gate.synthesize({
      conversationId: 'c1',
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: 'Hello',
      cacheEnabled: true,
    });
    expect(first).toMatchObject({ ok: false, disabled: true, shouldNotify: true, kind: 'auth' });

    const second = await gate.synthesize({
      conversationId: 'c1',
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: 'Hello again',
      cacheEnabled: true,
    });
    expect(second).toMatchObject({ ok: false, disabled: true, shouldNotify: false });
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
  });

  it('prunes disabled/notified tracking when over the cap', async () => {
    const tts = {
      synthesize: vi.fn(async () => {
        throw new ElevenLabsError('Nope', { kind: 'auth', status: 401 });
      }),
    } as unknown as ElevenLabsTtsService;
    const gate = new TtsConversationGate(tts, { maxTrackedConversationIds: 3 });

    await gate.synthesize({ conversationId: 'c1', apiKey: 'xi-test', voiceId: 'voice-123', text: '1', cacheEnabled: true });
    await gate.synthesize({ conversationId: 'c2', apiKey: 'xi-test', voiceId: 'voice-123', text: '2', cacheEnabled: true });
    await gate.synthesize({ conversationId: 'c3', apiKey: 'xi-test', voiceId: 'voice-123', text: '3', cacheEnabled: true });
    await gate.synthesize({ conversationId: 'c4', apiKey: 'xi-test', voiceId: 'voice-123', text: '4', cacheEnabled: true });

    // c2 should still be disabled (no more TTS calls)
    const c2Again = await gate.synthesize({
      conversationId: 'c2',
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: '2 again',
      cacheEnabled: true,
    });
    expect(c2Again).toMatchObject({ ok: false, disabled: true, shouldNotify: false });

    // c1 should have been pruned, so it will attempt again and notify again.
    const c1Again = await gate.synthesize({
      conversationId: 'c1',
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: '1 again',
      cacheEnabled: true,
    });
    expect(c1Again).toMatchObject({ ok: false, disabled: true, shouldNotify: true });

    expect(tts.synthesize).toHaveBeenCalledTimes(5);
  });

  it('passes through bytes on success', async () => {
    const tts = {
      synthesize: vi.fn(async () => ({ bytes: new Uint8Array([7]), fromCache: false })),
    } as unknown as ElevenLabsTtsService;
    const gate = new TtsConversationGate(tts);

    const res = await gate.synthesize({
      conversationId: 'c2',
      apiKey: 'xi-test',
      voiceId: 'voice-123',
      text: 'Hello',
      cacheEnabled: true,
    });
    expect(res).toEqual({ ok: true, bytes: new Uint8Array([7]) });
  });
});
