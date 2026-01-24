import { REDACTED, redactStringHeuristics } from './redaction';

// Keys containing encrypted/signature data from LLM APIs that should be truncated for display
// These are opaque blobs that must be round-tripped exactly but are meaningless to display in full
const TRUNCATE_FOR_DISPLAY_KEYS = new Set([
  'encrypted_content',    // OpenAI Responses API reasoning
  'thinking_signature',   // Anthropic extended thinking signature
  'signature',            // Anthropic thinking block signature
]);

const TRUNCATE_HEAD_CHARS = 4;
const TRUNCATE_TAIL_CHARS = 4;
const TRUNCATE_MIN_LENGTH = TRUNCATE_HEAD_CHARS + TRUNCATE_TAIL_CHARS + 3; // "xxxx...xxxx"

function truncateForDisplay(value: string): string {
  if (value.length < TRUNCATE_MIN_LENGTH) return value;
  return `${value.slice(0, TRUNCATE_HEAD_CHARS)}...${value.slice(-TRUNCATE_TAIL_CHARS)}`;
}

function shouldTruncateForDisplay(key: string): boolean {
  return TRUNCATE_FOR_DISPLAY_KEYS.has(key);
}

function shouldRedactKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    k.includes('apikey') ||
    k.includes('accesskey') ||
    k.includes('secret') ||
    k.includes('password') ||
    k.endsWith('token') ||
    k === 'auth' ||
    k.includes('authorization')
  );
}

/* eslint-disable @typescript-eslint/no-unsafe-return */
export function safeStringify(value: unknown): string {
  try {
    const rendered = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (typeof key === 'string' && shouldRedactKey(key)) return REDACTED;
        // Truncate encrypted/signature fields from LLM APIs for display (first 4...last 4 chars)
        if (typeof key === 'string' && typeof val === 'string' && shouldTruncateForDisplay(key)) {
          return truncateForDisplay(val);
        }
        if (typeof val === 'string') return redactStringHeuristics(val);
        return val;
      }
    );
    if (typeof rendered === 'string') return rendered;
    return '<unserializable: undefined>';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `<unserializable: ${reason}>`;
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-return */
