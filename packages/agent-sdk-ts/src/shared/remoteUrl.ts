const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeRemoteUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;

  if (url.startsWith('ws://')) url = `http://${url.slice('ws://'.length)}`;
  else if (url.startsWith('wss://')) url = `https://${url.slice('wss://'.length)}`;
  else if (!HAS_SCHEME_RE.test(url)) url = `http://${url}`;

  return url.replace(/\/+$/, '');
}

