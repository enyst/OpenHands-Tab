import type { ElevenLabsTtsService } from './ttsService';
import type { ElevenLabsErrorKind } from './ttsClient';

export type HalTtsRequest = {
  conversationId: string;
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  cacheEnabled: boolean;
};

export type HalTtsResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string; kind: ElevenLabsErrorKind; disabled: boolean; shouldNotify: boolean };

export class TtsConversationGate {
  private readonly disabled = new Set<string>();
  private readonly notified = new Set<string>();

  constructor(private readonly tts: ElevenLabsTtsService) {}

  async synthesize(req: HalTtsRequest): Promise<HalTtsResult> {
    if (this.disabled.has(req.conversationId)) {
      return {
        ok: false,
        error: 'HAL audio is disabled for this conversation',
        kind: 'config',
        disabled: true,
        shouldNotify: false,
      };
    }

    try {
      const { bytes } = await this.tts.synthesize({
        apiKey: req.apiKey,
        voiceId: req.voiceId,
        text: req.text,
        modelId: req.modelId,
        cacheEnabled: req.cacheEnabled,
        maxRetries: 2,
      });
      return { ok: true, bytes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = (err as { kind?: ElevenLabsErrorKind } | undefined)?.kind ?? 'unknown';
      this.disabled.add(req.conversationId);
      const shouldNotify = !this.notified.has(req.conversationId);
      if (shouldNotify) this.notified.add(req.conversationId);
      return { ok: false, error: message, kind, disabled: true, shouldNotify };
    }
  }
}

