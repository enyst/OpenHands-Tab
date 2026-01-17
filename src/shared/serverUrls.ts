export type NormalizeServerUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const HAS_EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeServerUrl(raw: string): NormalizeServerUrlResult {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'Server URL is required' };
  }

  const hasLocalHostnamePrefix =
    /^localhost([/:?#]|$)/i.test(trimmed) ||
    /^127\.0\.0\.1([/:?#]|$)/.test(trimmed) ||
    /^(?:\[::1\]|::1)([/:?#]|$)/.test(trimmed);

  let candidate = trimmed;
  if (/^(https?|wss?):/i.test(candidate) && !/^(https?|wss?):\/\//i.test(candidate)) {
    candidate = candidate.replace(/^(https?|wss?):/i, (match) => `${match}//`);
  } else if (!HAS_EXPLICIT_SCHEME.test(candidate)) {
    const scheme = hasLocalHostnamePrefix ? 'http' : 'https';
    let host = candidate;

    if (!host.startsWith('[') && /^::1($|[/?#])/.test(host)) {
      host = host.replace(/^::1/, '[::1]');
    } else if (!host.startsWith('[')) {
      const match = host.match(/^::1:(\d+)($|[/?#])/);
      if (match) {
        host = host.replace(/^::1:(\d+)/, '[::1]:$1');
      }
    }

    candidate = `${scheme}://${host}`;
  }

  if (/^ws:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^ws:/i, 'http:');
  } else if (/^wss:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^wss:/i, 'https:');
  }

  candidate = candidate.replace(/^(https?:\/\/)::1(?=[:/?#]|$)/i, '$1[::1]');

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported' };
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'Invalid URL (missing hostname)' };
  }

  parsed.hash = '';
  parsed.search = '';

  const canonical =
    parsed.pathname === '/' ? parsed.origin : parsed.toString();
  return { ok: true, url: canonical };
}
