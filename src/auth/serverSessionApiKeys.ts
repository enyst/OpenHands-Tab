import { createHash } from 'crypto';
import { normalizeServerUrl } from '../shared/serverUrls';

export const LEGACY_SESSION_API_KEY_SECRET_KEY = 'openhands.sessionApiKey';

export type ServerSessionApiKeySecretKeyResult =
  | { ok: true; normalizedServerUrl: string; secretKey: string }
  | { ok: false; error: string };

export function getServerSessionApiKeySecretKey(serverUrl: string): ServerSessionApiKeySecretKeyResult {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const hash = createHash('sha256').update(normalized.url).digest('hex');
  return {
    ok: true,
    normalizedServerUrl: normalized.url,
    secretKey: `${LEGACY_SESSION_API_KEY_SECRET_KEY}.server.${hash}`,
  };
}

