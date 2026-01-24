import { getPerServerSecretKey, type PerServerSecretKeyResult } from './serverSecretKeys';

export const RUNTIME_SESSION_API_KEY_SECRET_KEY = 'openhands.runtimeSessionApiKey';

export type ServerRuntimeSessionApiKeySecretKeyResult = PerServerSecretKeyResult;

export function getServerRuntimeSessionApiKeySecretKey(serverUrl: string): ServerRuntimeSessionApiKeySecretKeyResult {
  return getPerServerSecretKey(serverUrl, RUNTIME_SESSION_API_KEY_SECRET_KEY);
}
