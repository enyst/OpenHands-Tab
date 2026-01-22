import { normalizeServerUrl } from './serverUrls';

export function isOpenHandsCloudServerUrl(raw: string): boolean {
  const normalized = normalizeServerUrl(raw);
  if (!normalized.ok) return false;

  try {
    const url = new URL(normalized.url);
    // Keep this conservative: only treat the known SaaS host as “cloud”.
    // If we need to support additional enterprise cloud hosts, expand this list explicitly.
    return url.hostname.toLowerCase() === 'app.all-hands.dev';
  } catch {
    return false;
  }
}

export function getRemoteAuthKeyLabelForServerUrl(raw: string): string {
  return isOpenHandsCloudServerUrl(raw) ? 'Cloud API Key' : 'Session API Key';
}

