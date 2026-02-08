import type { AgentErrorEvent, ConversationErrorEvent } from '@smolpaws/agent-sdk';

type ErrorSummary = { message: string; hint?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const stripDiagnosticContext = (input: string): { text: string; modelHint?: string } => {
  const modelMatch = input.match(/llm\.(effectiveModel|model)=([^) ,]+)/i);
  const modelHint = modelMatch?.[2];

  const markers = ['(mode=', '(llm.', '(serverUrl='];
  let cutoff = input.length;
  for (const marker of markers) {
    const index = input.indexOf(marker);
    if (index !== -1 && index < cutoff) cutoff = index;
  }

  return { text: input.slice(0, cutoff).trim(), modelHint };
};

const extractJsonMessage = (input: string): string | undefined => {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(input.slice(start, end + 1)) as unknown;
    if (!isRecord(parsed)) return undefined;
    const parsedError = isRecord(parsed.error) ? parsed.error : undefined;
    if (typeof parsedError?.message === 'string') return parsedError.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    return undefined;
  }
  return undefined;
};

const extractInlineMessage = (input: string): string | undefined => {
  const messageField = input.match(/"message"\s*:\s*"([^"]+)"/i);
  if (messageField?.[1]) return messageField[1];
  const firstColon = input.indexOf(':');
  if (firstColon === -1) return undefined;
  const tail = input.slice(firstColon + 1).trim();
  return tail || undefined;
};

const deriveHint = (raw: string, providerMessage: string | undefined, modelHint?: string): string | undefined => {
  const needle = (providerMessage ?? raw).toLowerCase();
  const mentionsTemperature = needle.includes('temperature');
  const mentionsGpt5 = (modelHint ?? raw).toLowerCase().includes('gpt-5');
  if (mentionsTemperature && mentionsGpt5) {
    return 'GPT-5 models do not support temperature. Remove temperature from this profile.';
  }
  return undefined;
};

const toUserFacingError = (raw: string): ErrorSummary => {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return { message: 'An unexpected error occurred.' };

  const { text, modelHint } = stripDiagnosticContext(normalized);
  const statusMatch = text.match(/LLM request failed\s*\(?(?:HTTP\s*)?(\d{3})\)?/i);
  const status = statusMatch?.[1];
  const providerMessage = extractJsonMessage(text) ?? extractInlineMessage(text);

  const fallback = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  const message = status
    ? `LLM request failed (${status}): ${providerMessage ?? 'See Output for details.'}`
    : providerMessage ?? fallback;
  const hint = deriveHint(normalized, providerMessage, modelHint);
  return hint ? { message, hint } : { message };
};

export const summarizeAgentErrorEvent = (event: AgentErrorEvent): AgentErrorEvent & { hint?: string } => {
  const summary = toUserFacingError(event.error);
  return {
    ...event,
    error: summary.message,
    ...(summary.hint ? { hint: summary.hint } : {}),
  };
};

export const summarizeConversationErrorEvent = (
  event: ConversationErrorEvent,
): ConversationErrorEvent & { hint?: string } => {
  const source = event.detail ?? event.code ?? 'Conversation error';
  const summary = toUserFacingError(source);
  return {
    ...event,
    detail: summary.message,
    ...(summary.hint ? { hint: summary.hint } : {}),
  };
};
