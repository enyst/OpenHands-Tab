import { createHash } from 'crypto';
import { normalizeServerUrl } from '../shared/serverUrls';

export type PerServerSecretKeyResult =
  | { ok: true; normalizedServerUrl: string; secretKey: string }
  | { ok: false; error: string };

export function getPerServerSecretKey(serverUrl: string, prefix: string): PerServerSecretKeyResult {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const hash = createHash('sha256').update(normalized.url).digest('hex');
  return {
    ok: true,
    normalizedServerUrl: normalized.url,
    secretKey: `${prefix}.server.${hash}`,
  };
}
