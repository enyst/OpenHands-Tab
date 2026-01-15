export type NormalizeHttpBaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const HAS_EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeHttpBaseUrl(raw: string): NormalizeHttpBaseUrlResult {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { ok: false, error: 'Base URL is required' };

  let candidate = trimmed;
  if (/^(https?|wss?):/i.test(candidate) && !HAS_EXPLICIT_SCHEME.test(candidate)) {
    candidate = candidate.replace(/^(https?|wss?):/i, (match) => `${match}//`);
  } else if (!HAS_EXPLICIT_SCHEME.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported' };
  }
  if (!parsed.hostname) return { ok: false, error: 'Invalid URL (missing hostname)' };

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

  const canonical = parsed.pathname === '/' ? parsed.origin : parsed.toString();
  return { ok: true, url: canonical };
}

export function buildVerificationUriComplete(verificationUri: string, userCode: string): string {
  const uri = typeof verificationUri === 'string' ? verificationUri.trim() : '';
  const code = typeof userCode === 'string' ? userCode.trim() : '';
  if (!uri || !code) return uri;

  const [beforeHash, hashPart] = uri.split('#', 2);
  const [base, queryRaw = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(queryRaw);
  params.set('user_code', code);
  const query = params.toString();

  const rebuilt = query ? `${base}?${query}` : base;
  return hashPart ? `${rebuilt}#${hashPart}` : rebuilt;
}

