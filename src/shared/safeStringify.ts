const REDACTED = '[REDACTED]';

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

function redactStringHeuristics(text: string): string {
  let t = text;

  // Authorization / Bearer patterns
  t = t.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);
  t = t.replace(/(Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);

  // Common token prefixes
  t = t.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, REDACTED);
  t = t.replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/gi, REDACTED);
  t = t.replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/gi, REDACTED);

  // AWS access key ids (AKIA..., ASIA...)
  t = t.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED);

  // Common key=value or key: value patterns
  const keyPattern =
    /(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)/gi;
  t = t.replace(new RegExp(`(${keyPattern.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'), (_m, key) => `${key}: ${REDACTED}`);
  t = t.replace(new RegExp(`([?&])(${keyPattern.source})=([^&\\s]+)`, 'gi'), (_m, sep, key) => `${sep}${key}=${REDACTED}`);

  return t;
}

/* eslint-disable @typescript-eslint/no-unsafe-return */
export function safeStringify(value: unknown): string {
  try {
    const rendered = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (typeof key === 'string' && shouldRedactKey(key)) return REDACTED;
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

