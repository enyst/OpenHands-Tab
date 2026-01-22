import { normalizeServerUrl } from './serverUrls';

function getExtraCloudHostnames(): string[] {
  const raw = typeof process !== 'undefined' ? process.env.OPENHANDS_CLOUD_HOSTNAMES : undefined;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isOpenHandsCloudServerUrl(raw: string): boolean {
  const normalized = normalizeServerUrl(raw);
  if (!normalized.ok) return false;

  try {
    const url = new URL(normalized.url);
    // Keep this conservative: only treat the known SaaS host as “cloud”.
    // If we need to support additional enterprise cloud hosts, expand this list explicitly.
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'app.all-hands.dev') return true;
    // Test-only / explicit override hook for hermetic CI E2E (e.g. mock SaaS on localhost).
    const extra = getExtraCloudHostnames();
    return extra.includes(hostname);
  } catch {
    return false;
  }
}

export function getRemoteAuthKeyLabelForServerUrl(raw: string): string {
  return isOpenHandsCloudServerUrl(raw) ? 'Cloud API Key' : 'Runtime Session API Key';
}
