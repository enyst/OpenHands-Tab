import type { ChatCompletionRequest, LLMProvider } from './types';
import { reduceTextContent } from './types';

const collectErrorTextParts = (params: {
  error: unknown;
  depth: number;
  seen: Set<unknown>;
}): string[] => {
  if (params.depth <= 0) return [];

  const error = params.error;
  if (error === null || error === undefined) return [];
  if (typeof error === 'string') return [error];

  if (typeof error === 'object') {
    if (params.seen.has(error)) return [];
    params.seen.add(error);

    if (error instanceof Error) {
      const parts: string[] = [];
      if (error.message) parts.push(error.message);
      const cause = (error as Error & { cause?: unknown }).cause;
      if (cause && !params.seen.has(cause)) {
        parts.push(...collectErrorTextParts({ error: cause, depth: params.depth - 1, seen: params.seen }));
      }
      return parts;
    }

    const maybe = error as { message?: unknown; cause?: unknown };
    const parts: string[] = [];
    if (typeof maybe.message === 'string' && maybe.message.trim()) parts.push(maybe.message);

    if (maybe.cause && !params.seen.has(maybe.cause)) {
      parts.push(...collectErrorTextParts({ error: maybe.cause, depth: params.depth - 1, seen: params.seen }));
    }

    try {
      parts.push(JSON.stringify(error));
    } catch {
      // ignore stringify failures
    }

    if (!parts.length) parts.push(Object.prototype.toString.call(error));
    return parts;
  }

  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return [String(error)];
  }
  if (typeof error === 'symbol') {
    return [error.description ? `Symbol(${error.description})` : 'Symbol()'];
  }
  if (typeof error === 'function') {
    return [error.name ? `[function ${error.name}]` : '[function]'];
  }

  return [];
};

const normalizeErrorText = (error: unknown): string => {
  const seen = new Set<unknown>();
  return collectErrorTextParts({ error, depth: 6, seen }).join('\n');
};

const containsAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/**
 * Best-effort classifier for "context window / token limit exceeded" errors.
 *
 * This intentionally errs on the side of false negatives (to avoid triggering
 * condensation on unrelated failures).
 */
export const isContextLimitError = (provider: LLMProvider | undefined, error: unknown): boolean => {
  const text = normalizeErrorText(error).toLowerCase();
  if (!text) return false;

  const genericNeedles = [
    'context_length_exceeded',
    'maximum context length',
    'prompt is too long',
    'token limit',
    'exceeds the maximum number of tokens',
    'reduce the length',
    'context window exceeded',
    'contextwindowexceedederror',
  ];

  // Provider-specific hints first (most reliable).
  switch (provider) {
    case 'openai':
    case 'openrouter':
    case 'litellm_proxy': {
      if (
        containsAny(text, [
        'context_length_exceeded',
        'maximum context length',
        "this model's maximum context length",
        'too many tokens',
        'reduce the length of the messages',
        'tokens in the prompt',
        // LiteLLM proxy can wrap Anthropic-style errors (e.g. "prompt is too long: X tokens > Y maximum").
        'prompt is too long',
        'contextwindowexceedederror',
      ])
      ) {
        return true;
      }
      break;
    }
    case 'anthropic': {
      if (
        containsAny(text, [
        'prompt is too long',
        'prompt too long',
        'context length exceeded',
        'tokens exceeded',
      ])
      ) {
        return true;
      }
      break;
    }
    case 'gemini': {
      if (
        containsAny(text, [
        'prompttokencount',
        'candidatestokencount',
        'exceeds the maximum',
        'maximum number of tokens',
        'input token',
        'token limit',
        'context length',
      ])
      ) {
        return true;
      }
      break;
    }
    default:
      break;
  }

  // Generic fallback heuristics.
  return containsAny(text, genericNeedles);
};

const estimateTokens = (text: string): number => {
  const chars = text.trim().length;
  if (chars <= 0) return 0;
  // ~4 chars/token heuristic (conservative).
  return Math.ceil(chars / 4);
};

export const estimateRequestTokens = (request: ChatCompletionRequest): number => {
  const parts: string[] = [];
  parts.push(request.systemPrompt);

  for (const message of request.messages) {
    parts.push(message.role);
    if (message.name) parts.push(message.name);
    if (message.tool_call_id) parts.push(message.tool_call_id);
    parts.push(reduceTextContent(message));
    if (message.role === 'assistant' && message.tool_calls?.length) {
      try {
        parts.push(JSON.stringify(message.tool_calls));
      } catch {
        // ignore stringify failures
      }
    }
  }

  if (request.tools?.length) {
    try {
      parts.push(JSON.stringify(request.tools));
    } catch {
      // ignore stringify failures
    }
  }

  return estimateTokens(parts.join('\n'));
};

export const wouldExceedMaxInputTokens = (params: {
  request: ChatCompletionRequest;
  maxInputTokens: number | null | undefined;
}): boolean => {
  const raw = params.maxInputTokens;
  const maxTokens = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : undefined;
  if (!maxTokens || maxTokens <= 0) return false;
  return estimateRequestTokens(params.request) > maxTokens;
};
