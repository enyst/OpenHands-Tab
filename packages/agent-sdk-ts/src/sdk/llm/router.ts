import type { Message } from '../types';
import { isImageContent } from '../types';
import type { ChatCompletionRequest, LLMClient, LLMProvider } from './types';
import { classifyLlmErrorCode } from './errorMapping';

export type RouterSelectContext = {
  request: ChatCompletionRequest;
  /** Full concatenated user+assistant+tool message history for the request. */
  messages: Message[];
  /** Convenience: whether the request contains any image content. */
  hasImages: boolean;
};

export type LlmRouter = {
  /** Return the key for the client to use. */
  select: (context: RouterSelectContext) => string;
};

export type RouterLlmClientOptions = {
  clients: Record<string, LLMClient>;
  router: LlmRouter;
};

export function createRouterLlmClient(options: RouterLlmClientOptions): LLMClient {
  const keys = Object.keys(options.clients);
  if (keys.length === 0) {
    throw new Error('Router LLM requires at least one client');
  }

  return {
    async *streamChat(request: ChatCompletionRequest) {
      const messages = request.messages;
      const hasImages = messages.some((m) => m.content.some(isImageContent));
      const key = options.router.select({ request, messages, hasImages });
      const client = options.clients[key];
      if (!client) {
        throw new Error(`Router selected missing LLM key '${key}'. Available: ${keys.join(', ')}`);
      }
      yield* client.streamChat(request);
    },
  };
}

export type FallbackLlmClientOptions = {
  primary: LLMClient;
  fallback: LLMClient;
  shouldFallback: (error: unknown) => boolean;
};

export function createFallbackLlmClient(options: FallbackLlmClientOptions): LLMClient {
  return {
    async *streamChat(request: ChatCompletionRequest) {
      let yielded = false;
      try {
        for await (const chunk of options.primary.streamChat(request)) {
          yielded = true;
          yield chunk;
        }
      } catch (error) {
        if (yielded) {
          throw error;
        }
        if (!options.shouldFallback(error)) {
          throw error;
        }
        yield* options.fallback.streamChat(request);
      }
    },
  };
}

export const shouldFallbackOnLlmErrorCodes = (params: {
  provider?: LLMProvider | null;
  codes: string[];
}): ((error: unknown) => boolean) => {
  const allow = new Set(params.codes.map((c) => c.trim()).filter(Boolean));
  return (error: unknown): boolean => {
    const code = classifyLlmErrorCode({ provider: params.provider ?? undefined, error });
    return typeof code === 'string' && allow.has(code);
  };
};
