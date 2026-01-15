import { buildVerificationUriComplete } from './url';

export type HttpResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type HttpClientLike = (url: string, init: {
  method: 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignalLike;
}) => Promise<HttpResponseLike>;

export type AbortSignalLike = { aborted?: boolean };

export type Clock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const DEFAULT_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  intervalMs: number;
};

export type DeviceToken = {
  accessToken: string;
  tokenType?: string;
  expiresInSeconds?: number;
};

type DeviceAuthorizationResponse = {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  verification_uri_complete?: unknown;
  interval?: unknown;
};

type DeviceTokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new DeviceFlowProtocolError(`${context}: expected JSON object`);
  return value;
}

function clampPollIntervalMs(value: number): number {
  if (!Number.isFinite(value)) return 5000;
  return Math.max(1000, Math.trunc(value));
}

const MAX_SLOW_DOWN_INTERVAL_MS = 30_000;

export class DeviceFlowProtocolError extends Error {
  override name = 'DeviceFlowProtocolError';
}

export class DeviceFlowHttpError extends Error {
  override name = 'DeviceFlowHttpError';
  readonly status: number;
  readonly bodyText: string;

  constructor(message: string, params: { status: number; bodyText: string }) {
    super(message);
    this.status = params.status;
    this.bodyText = params.bodyText;
  }
}

export class DeviceFlowNetworkError extends Error {
  override name = 'DeviceFlowNetworkError';
}

export class DeviceFlowTimeoutError extends Error {
  override name = 'DeviceFlowTimeoutError';
}

export class DeviceFlowCancelledError extends Error {
  override name = 'DeviceFlowCancelledError';
}

export class DeviceFlowTokenError extends Error {
  override name = 'DeviceFlowTokenError';
  readonly error: string;
  readonly errorDescription?: string;

  constructor(message: string, params: { error: string; errorDescription?: string }) {
    super(message);
    this.error = params.error;
    this.errorDescription = params.errorDescription;
  }
}

export async function startDeviceAuthorization(options: {
  baseUrl: string;
  http: HttpClientLike;
  authorizePath?: string;
  signal?: AbortSignalLike;
}): Promise<DeviceAuthorization> {
  const authorizePath = options.authorizePath ?? '/oauth/device/authorize';
  const url = new URL(authorizePath, options.baseUrl).toString();

  let res: HttpResponseLike;
  try {
    res = await options.http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: options.signal,
    });
  } catch (err) {
    throw new DeviceFlowNetworkError(`Device authorization request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DeviceFlowHttpError('Device authorization request failed', { status: res.status, bodyText: text });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new DeviceFlowProtocolError('Device authorization response was not valid JSON');
  }

  const obj = parseJsonRecord(json, 'Device authorization response');
  const data = obj as DeviceAuthorizationResponse;

  const deviceCode = typeof data.device_code === 'string' ? data.device_code.trim() : '';
  const userCode = typeof data.user_code === 'string' ? data.user_code.trim() : '';
  const verificationUri = typeof data.verification_uri === 'string' ? data.verification_uri.trim() : '';
  const verificationUriCompleteRaw = typeof data.verification_uri_complete === 'string' ? data.verification_uri_complete.trim() : '';
  if (!deviceCode || !userCode || !verificationUri) {
    throw new DeviceFlowProtocolError('Device authorization response missing required fields');
  }

  const intervalSeconds = typeof data.interval === 'number' && Number.isFinite(data.interval) ? Math.trunc(data.interval) : 5;
  const intervalMs = clampPollIntervalMs(intervalSeconds * 1000);

  const verificationUriComplete = verificationUriCompleteRaw || buildVerificationUriComplete(verificationUri, userCode);

  return { deviceCode, userCode, verificationUri, verificationUriComplete, intervalMs };
}

export async function pollDeviceToken(options: {
  baseUrl: string;
  deviceCode: string;
  pollIntervalMs: number;
  http: HttpClientLike;
  tokenPath?: string;
  timeoutMs?: number;
  signal?: AbortSignalLike;
  clock?: Clock;
}): Promise<DeviceToken> {
  const tokenPath = options.tokenPath ?? '/oauth/device/token';
  const url = new URL(tokenPath, options.baseUrl).toString();
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 10 * 60_000;
  const clock = options.clock ?? DEFAULT_CLOCK;

  const deviceCode = typeof options.deviceCode === 'string' ? options.deviceCode.trim() : '';
  if (!deviceCode) throw new DeviceFlowProtocolError('deviceCode is required');

  const startedAt = clock.now();
  let pollIntervalMs = clampPollIntervalMs(options.pollIntervalMs);

  const body = new URLSearchParams({
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }).toString();

  while (true) {
    if (options.signal?.aborted) throw new DeviceFlowCancelledError('Device flow cancelled');
    if (clock.now() - startedAt > timeoutMs) throw new DeviceFlowTimeoutError('Timeout waiting for user authorization (device flow)');

    let res: HttpResponseLike;
    try {
      res = await options.http(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: options.signal,
      });
    } catch (err) {
      throw new DeviceFlowNetworkError(`Device token request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      const text = await res.text().catch(() => '');
      if (res.status !== 200) {
        throw new DeviceFlowProtocolError(`Unexpected response from server: ${res.status}`);
      }
      throw new DeviceFlowProtocolError(`Device token response was not valid JSON: ${text}`);
    }

    const obj = parseJsonRecord(json, 'Device token response') as DeviceTokenResponse;
    const accessToken = typeof obj.access_token === 'string' ? obj.access_token.trim() : '';
    if (accessToken) {
      const tokenType = typeof obj.token_type === 'string' ? obj.token_type : undefined;
      const expiresInSeconds = typeof obj.expires_in === 'number' && Number.isFinite(obj.expires_in) ? Math.trunc(obj.expires_in) : undefined;
      return { accessToken, tokenType, expiresInSeconds };
    }

    const error = typeof obj.error === 'string' ? obj.error : '';
    const errorDescription = typeof obj.error_description === 'string' ? obj.error_description : undefined;

    if (error === 'authorization_pending') {
      await clock.sleep(pollIntervalMs);
      continue;
    }

    if (error === 'slow_down') {
      pollIntervalMs = Math.min(clampPollIntervalMs(pollIntervalMs * 2), MAX_SLOW_DOWN_INTERVAL_MS);
      await clock.sleep(pollIntervalMs);
      continue;
    }

    if (error === 'expired_token') {
      throw new DeviceFlowTokenError('Device code has expired. Please restart the device authorization flow.', { error, errorDescription });
    }

    if (error === 'access_denied') {
      throw new DeviceFlowTokenError('User denied the authorization request.', { error, errorDescription });
    }

    if (error) {
      const suffix = errorDescription ? ` - ${errorDescription}` : '';
      throw new DeviceFlowTokenError(`Authorization error: ${error}${suffix}`, { error, errorDescription });
    }

    if (!res.ok) {
      throw new DeviceFlowHttpError('Device token request failed', { status: res.status, bodyText: JSON.stringify(obj) });
    }

    throw new DeviceFlowProtocolError('Device token response missing access_token and error');
  }
}
