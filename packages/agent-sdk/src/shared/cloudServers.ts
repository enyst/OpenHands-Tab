import { normalizeRemoteUrl } from './remoteUrl';

export function isOpenHandsCloudServerUrl(raw: string): boolean {
  const normalized = normalizeRemoteUrl(raw);
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    return url.hostname.toLowerCase() === 'app.all-hands.dev';
  } catch {
    return false;
  }
}

export function getRemoteAuthKeyLabelForServerUrl(raw: string): string {
  return isOpenHandsCloudServerUrl(raw) ? 'Cloud API Key' : 'Runtime Session API Key';
}
