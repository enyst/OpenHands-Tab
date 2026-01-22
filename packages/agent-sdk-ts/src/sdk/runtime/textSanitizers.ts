import type { ChatCompletionRequest } from '../llm';
import type { Message, ToolCall } from '../types';

// Shared truncation limit for logged/tool result sizes.
const TRUNCATE_LIMIT = 2000;
export const ELLIPSIS = '…(truncated)';

export function truncateString(input: string): string {
  return input.length > TRUNCATE_LIMIT ? input.slice(0, TRUNCATE_LIMIT) + ELLIPSIS : input;
}

const DEBUG_TOOL_TEXT_HEAD_CHARS = 100;
const DEBUG_TOOL_TEXT_TAIL_CHARS = 100;
const DEBUG_TOOL_TEXT_MAX_UNCLIPPED = DEBUG_TOOL_TEXT_HEAD_CHARS + DEBUG_TOOL_TEXT_TAIL_CHARS;

const truncateToolMessageForDebug = (text: string): string => {
  if (text.length <= DEBUG_TOOL_TEXT_MAX_UNCLIPPED) return text;
  return `${text.slice(0, DEBUG_TOOL_TEXT_HEAD_CHARS)}…${text.slice(-DEBUG_TOOL_TEXT_TAIL_CHARS)}`;
};

// Redaction utilities for tool-call argument logging.
const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'api-key', 'apikey',
  'token', 'access_token', 'accessToken', 'refresh_token',
  'authorization', 'authorization_header', 'auth',
  'password', 'pass', 'pwd',
  'secret', 'secret_key', 'secretKey', 'client_secret', 'clientSecret', 'private_key', 'privateKey',
  'awsAccessKeyId', 'awsSecretAccessKey',
  'cloudApiKey', 'cloud_api_key',
  'runtimeSessionApiKey', 'runtime_session_api_key',
  'sessionApiKey', 'session_api_key', 'x_api_key', 'x-api-key',
]);

const shouldRedactKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.endsWith('token') ||
    normalized === 'auth' ||
    normalized.includes('authorization') ||
    normalized === 'pass' ||
    normalized === 'pwd'
  );
};

const redactObject = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map((v) => redactObject(v));
  if (input && typeof input === 'object') {
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(src)) {
      if (SENSITIVE_KEYS.has(key.toString()) || shouldRedactKey(key.toString())) {
        out[key] = '***';
      } else if (typeof value === 'object') {
        out[key] = redactObject(value);
      } else if (typeof value === 'string') {
        out[key] = redactStringHeuristics(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  if (typeof input === 'string') return redactStringHeuristics(input);
  return input;
};

export function redactStringHeuristics(text: string): string {
  let t = text;
  // Authorization header
  t = t.replace(/(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
  // Standalone Bearer tokens
  t = t.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
  // Common token prefixes that may appear without key labels
  const tokenPatterns = [
    /sk-[A-Za-z0-9]{12,}/gi,
    /ghp_[A-Za-z0-9]{12,}/gi,
    /pat_[A-Za-z0-9_]{12,}/gi,
  ];
  tokenPatterns.forEach((pattern) => {
    t = t.replace(pattern, '***');
  });
  // Common key=value or key: value patterns
  const keyPattern = /(api[_-]?key|cloud[_-]?api[_-]?key|runtime[_-]?session[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret)/gi;
  t = t.replace(
    new RegExp(`(${keyPattern.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'),
    (_m, p1, _p2) => `${p1}: ***`,
  );
  // Query param style ...?api_key=xxx&
  t = t.replace(new RegExp(`([?&])${keyPattern.source}=([^&\\s]+)`, 'gi'), (_m, sep, key) => `${sep}${key}=***`);
  return t;
}

export function redactAndTruncateArgs(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const redacted = redactObject(parsed);
    return truncateString(JSON.stringify(redacted));
  } catch {
    return truncateString(redactStringHeuristics(raw));
  }
}

const sanitizeToolCallsForDebug = (toolCalls: ToolCall[] | undefined): ToolCall[] | undefined => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;
  return toolCalls.map((toolCall) => {
    const rawArgs = toolCall.function.arguments;
    const safeArgs = typeof rawArgs === 'string' ? redactAndTruncateArgs(rawArgs) : '';
    return {
      ...toolCall,
      function: { ...toolCall.function, arguments: safeArgs },
    };
  });
};

export const sanitizeMessageForDebug = (message: Message): Message => {
  const safeToolCalls = sanitizeToolCallsForDebug(message.tool_calls);
  const safeContent = message.role === 'tool'
    ? message.content.map((item) => (
      item.type === 'text'
        ? { ...item, text: truncateToolMessageForDebug(item.text) }
        : item
    ))
    : message.content;

  const out: Message = { ...message, content: safeContent };
  if (safeToolCalls) out.tool_calls = safeToolCalls;
  return out;
};

export function sanitizeChatRequestForDebug(
  request: ChatCompletionRequest,
  options?: { parameters?: Record<string, unknown> },
): { systemPrompt: string; messages: Message[]; tools: string[]; parameters?: Record<string, unknown> } {
  const toolNames = (request.tools ?? [])
    .map((t) => t.function?.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  const parameters = Object.entries(options?.parameters ?? {})
    .filter(([, value]) => value !== undefined)
    .reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  return {
    systemPrompt: 'SYSTEM_PROMPT',
    messages: request.messages.map(sanitizeMessageForDebug),
    tools: toolNames,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  };
}
