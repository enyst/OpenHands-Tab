import type { LLMProvider } from './types';
import { isContextLimitError } from './contextLimit';

type ErrnoException = Error & { code?: string; syscall?: string; address?: string; port?: number };

const normalizeErrorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const getErrnoCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const maybe = error as Partial<ErrnoException> & { cause?: unknown };
  if (typeof maybe.code === 'string') return maybe.code;
  if (maybe.cause && typeof maybe.cause === 'object') {
    const causeCode = (maybe.cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return undefined;
};

const looksLikeAbort = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as Error;
  if (e.name === 'AbortError') return true;
  const msg = normalizeErrorText(error).toLowerCase();
  return msg.includes('aborted') || msg.includes('aborterror');
};

const parseHttpStatusFromMessage = (message: string): number | undefined => {
  const text = message.trim();
  if (!text) return undefined;

  // Examples:
  // - "LLM request failed (400): ..."
  // - "LLM request failed (HTTP 400): ..."
  // - "Anthropic request failed (401): ..."
  const match = text.match(/\((?:HTTP )?(\d{3})\):/);
  if (!match) return undefined;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : undefined;
};

export const classifyLlmErrorCode = (params: {
  provider?: LLMProvider | null;
  error: unknown;
}): string | undefined => {
  const provider = params.provider ?? undefined;
  const error = params.error;

  if (isContextLimitError(provider, error)) return 'llm_context_limit';

  const errno = getErrnoCode(error);
  if (errno) {
    // Network-ish failures. Note that Node's fetch typically throws TypeError('fetch failed')
    // with a cause that includes these codes.
    if ([
      'ECONNREFUSED',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ].includes(errno)) {
      return 'llm_network_error';
    }
  }

  if (looksLikeAbort(error)) {
    return 'llm_timeout';
  }

  const message = normalizeErrorText(error);
  const status = parseHttpStatusFromMessage(message);
  if (typeof status !== 'number') return undefined;

  if (status === 401 || status === 403) return 'llm_auth';
  if (status === 429) return 'llm_rate_limit';
  if (status === 408 || status === 504) return 'llm_timeout';
  if ([500, 502, 503].includes(status)) return 'llm_service_unavailable';

  if (status >= 400 && status < 500) return 'llm_bad_request';

  return undefined;
};
