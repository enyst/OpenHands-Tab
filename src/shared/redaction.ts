export const REDACTED = '[REDACTED]';

const KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)/i;

const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/gi,
  // AWS access key ids (AKIA..., ASIA...)
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
];

export function redactStringHeuristics(text: string): string {
  let t = text;

  // Authorization / Bearer patterns
  t = t.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);
  t = t.replace(/(Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);
  // URL-embedded credentials (userinfo)
  t = t.replace(/((?:https?|wss?):\/\/)([^/\s@]+)@/gi, `$1${REDACTED}@`);

  TOKEN_PATTERNS.forEach((pattern) => {
    t = t.replace(pattern, REDACTED);
  });

  // Common key=value or key: value patterns
  t = t.replace(
    new RegExp(`(${KEY_PATTERN.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'),
    (_m, key) => `${key}: ${REDACTED}`
  );
  t = t.replace(
    new RegExp(`([?&])(${KEY_PATTERN.source})=([^&\\s]+)`, 'gi'),
    (_m, sep, key) => `${sep}${key}=${REDACTED}`
  );

  return t;
}
