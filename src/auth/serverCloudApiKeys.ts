import { createHash } from 'crypto';
import { normalizeServerUrl } from '../shared/serverUrls';

export const CLOUD_API_KEY_SECRET_KEY = 'openhands.cloudApiKey';

export type ServerCloudApiKeySecretKeyResult =
  | { ok: true; normalizedServerUrl: string; secretKey: string }
  | { ok: false; error: string };

export function getServerCloudApiKeySecretKey(serverUrl: string): ServerCloudApiKeySecretKeyResult {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const hash = createHash('sha256').update(normalized.url).digest('hex');
  return {
    ok: true,
    normalizedServerUrl: normalized.url,
    secretKey: `${CLOUD_API_KEY_SECRET_KEY}.server.${hash}`,
  };
}
