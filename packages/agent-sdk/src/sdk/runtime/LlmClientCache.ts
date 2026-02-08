import type { LLMClient } from '../llm';

type DebugContext = { model: string | null; profileId: string | null };

export class LlmClientCache<TStreamer> {
  private llmClientPromise?: Promise<LLMClient>;
  private streamerPromise?: Promise<TStreamer>;

  constructor(
    private readonly deps: {
      getInjectedClient?: () => LLMClient | undefined;
      createClient: () => Promise<LLMClient>;
      createStreamer: (client: LLMClient) => TStreamer;
      emitDebugStateUpdate?: (key: string, value: unknown) => void;
      getDebugContext?: () => DebugContext;
    },
  ) {}

  clear(): void {
    this.llmClientPromise = undefined;
    this.streamerPromise = undefined;
  }

  hasStreamerPromise(): boolean {
    return Boolean(this.streamerPromise);
  }

  async getPrimaryClient(): Promise<LLMClient> {
    const injected = this.deps.getInjectedClient?.();
    if (injected) return injected;

    if (!this.llmClientPromise) {
      const pending = Promise.resolve(this.deps.createClient());
      const wrapped = pending.catch((error) => {
        // Only clear if this is still the cached promise (avoid clobbering a newer one).
        if (this.llmClientPromise === wrapped) {
          this.llmClientPromise = undefined;
        }
        throw error;
      });
      this.llmClientPromise = wrapped;
    }
    return this.llmClientPromise;
  }

  async getStreamer(): Promise<TStreamer> {
    if (!this.streamerPromise) {
      const ctx = this.deps.getDebugContext?.() ?? { model: null, profileId: null };
      this.deps.emitDebugStateUpdate?.('agent_streamer_cache', {
        action: 'create',
        profileId: ctx.profileId,
        model: ctx.model,
      });

      const wrapped = (async () => {
        const client = await this.getPrimaryClient();
        return this.deps.createStreamer(client);
      })().catch((error) => {
        if (this.streamerPromise === wrapped) {
          this.streamerPromise = undefined;
        }
        throw error;
      });
      this.streamerPromise = wrapped;
    } else {
      this.deps.emitDebugStateUpdate?.('agent_streamer_cache', { action: 'reuse' });
    }

    return this.streamerPromise;
  }
}
