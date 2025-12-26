import { truncateString } from './textSanitizers';

export const CIRCULAR_REFERENCE_MARKER = '[Circular]';
export const TOOL_MESSAGE_CLIP_MARKER = '<response clipped>';
export const TOOL_MESSAGE_MAX_CHARS = 8_000;

export function deepTruncate(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return truncateString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
    seen.add(value);
    return value.map((v) => deepTruncate(v, seen));
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      try {
        return value.toISOString();
      } catch {
        return String(value);
      }
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return {};
    if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = deepTruncate(v, seen);
    }
    return out;
  }
  return value;
}

export function truncateToolMessage(text: string, maxChars = TOOL_MESSAGE_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const available = maxChars - TOOL_MESSAGE_CLIP_MARKER.length - 2;
  const half = Math.max(0, Math.floor(available / 2));
  const head = text.slice(0, half);
  const tail = text.slice(-half);
  return `${head}\n${TOOL_MESSAGE_CLIP_MARKER}\n${tail}`;
}

