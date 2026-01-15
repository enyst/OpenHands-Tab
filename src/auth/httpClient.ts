import { normalizeHttpBaseUrl } from './url';

export type HttpResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type HttpFetchLike = (url: string, init: {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<HttpResponseLike>;

export type AuthHttpJsonResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

export class AuthHttpProtocolError extends Error {
  override name = 'AuthHttpProtocolError';
}

export class AuthHttpNetworkError extends Error {
  override name = 'AuthHttpNetworkError';
}

export class AuthHttpStatusError extends Error {
  override name = 'AuthHttpStatusError';
  readonly status: number;
  readonly bodyText: string;
  readonly detail?: string;

  constructor(message: string, params: { status: number; bodyText: string; detail?: string }) {
    super(message);
    this.status = params.status;
    this.bodyText = params.bodyText;
    this.detail = params.detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractErrorDetail(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const detail = data.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();

  const errorDescription = data.error_description;
  if (typeof errorDescription === 'string' && errorDescription.trim()) return errorDescription.trim();

  const error = data.error;
  if (typeof error === 'string' && error.trim()) return error.trim();

  return undefined;
}

function joinEndpoint(baseUrl: string, endpoint: string): string {
  const trimmed = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!trimmed) return baseUrl;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, '');
  return new URL(withoutLeadingSlashes, `${base.origin}${basePath}`).toString();
}

export class AuthHttpClient {
  readonly baseUrl: string;
  private readonly fetch: HttpFetchLike;

  constructor(options: { baseUrl: string; fetch: HttpFetchLike }) {
    const normalized = normalizeHttpBaseUrl(options.baseUrl);
    if (!normalized.ok) throw new AuthHttpProtocolError(normalized.error);
    this.baseUrl = normalized.url;
    this.fetch = options.fetch;
  }

  async requestJson<T = unknown>(options: {
    method: string;
    endpoint: string;
    json?: unknown;
    formData?: Record<string, string>;
    headers?: Record<string, string>;
    raiseForStatus?: boolean;
  }): Promise<AuthHttpJsonResponse<T>> {
    const raiseForStatus = options.raiseForStatus !== false;
    const url = joinEndpoint(this.baseUrl, options.endpoint);

    if (options.json !== undefined && options.formData) {
      throw new AuthHttpProtocolError('Expected either json or formData, not both');
    }

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: string | undefined;

    if (options.formData) {
      headers['content-type'] = headers['content-type'] ?? 'application/x-www-form-urlencoded';
      body = new URLSearchParams(options.formData).toString();
    } else if (options.json !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      body = JSON.stringify(options.json);
    }

    let res: HttpResponseLike;
    try {
      res = await this.fetch(url, { method: options.method, headers, body });
    } catch (err) {
      throw new AuthHttpNetworkError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      const text = await res.text().catch(() => '');
      if (raiseForStatus && !res.ok) {
        throw new AuthHttpStatusError(`Unexpected response from server: ${res.status}`, { status: res.status, bodyText: text });
      }
      throw new AuthHttpProtocolError('Response was not valid JSON');
    }

    if (raiseForStatus && !res.ok) {
      const detail = extractErrorDetail(json);
      const message = `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
      throw new AuthHttpStatusError(message, { status: res.status, bodyText: JSON.stringify(json), detail });
    }

    return { ok: res.ok, status: res.status, data: json as T };
  }
}

