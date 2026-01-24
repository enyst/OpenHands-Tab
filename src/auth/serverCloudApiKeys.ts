import { getPerServerSecretKey, type PerServerSecretKeyResult } from './serverSecretKeys';

export const CLOUD_API_KEY_SECRET_KEY = 'openhands.cloudApiKey';

export type ServerCloudApiKeySecretKeyResult = PerServerSecretKeyResult;

export function getServerCloudApiKeySecretKey(serverUrl: string): ServerCloudApiKeySecretKeyResult {
  return getPerServerSecretKey(serverUrl, CLOUD_API_KEY_SECRET_KEY);
}
