import type { ChatCompletionRequest, LLMProvider } from './types';
import { reduceTextContent } from './types';

const normalizeErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

  // Provider-specific hints first (most reliable).
  switch (provider) {
    case 'openai':
    case 'openrouter':
    case 'litellm_proxy': {
      return containsAny(text, [
        'context_length_exceeded',
        'maximum context length',
        "this model's maximum context length",
        'too many tokens',
        'reduce the length of the messages',
        'tokens in the prompt',
      ]);
    }
    case 'anthropic': {
      return containsAny(text, [
        'prompt is too long',
        'prompt too long',
        'context length exceeded',
        'tokens exceeded',
      ]);
    }
    case 'gemini': {
      return containsAny(text, [
        'prompttokencount',
        'candidatestokencount',
        'exceeds the maximum',
        'maximum number of tokens',
        'input token',
        'token limit',
        'context length',
      ]);
    }
    default:
      break;
  }

  // Generic fallback heuristics.
  return containsAny(text, [
    'context_length_exceeded',
    'maximum context length',
    'prompt is too long',
    'token limit',
    'exceeds the maximum number of tokens',
    'reduce the length',
  ]);
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
