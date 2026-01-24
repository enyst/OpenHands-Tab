import { normalizeServerUrl } from '../shared/serverUrls';

export type CloudBootstrapResult = {
  saasServerUrl: string;
  appConversationId: string;
  conversationUrl: string;
  nestedServerUrl: string;
  conversationId: string;
  runtimeSessionApiKey: string;
};

type AppConversationStartTask = {
  status?: unknown;
  detail?: unknown;
  app_conversation_id?: unknown;
};

type AppConversation = {
  conversation_url?: unknown;
  session_api_key?: unknown;
};

const MAX_ERROR_DETAIL_CHARS = 300;

function parseNestedConversationUrl(conversationUrl: string): { nestedServerUrl: string; conversationId: string } | null {
  let url: URL;
  try {
    url = new URL(conversationUrl);
  } catch {
    return null;
  }

  const pathname = url.pathname.replace(/\/$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const conversationsIndex = parts.lastIndexOf('conversations');
  if (conversationsIndex <= 0) return null;
  if (parts[conversationsIndex - 1] !== 'api') return null;
  const id = parts[conversationsIndex + 1];
  if (!id) return null;

  const baseParts = parts.slice(0, conversationsIndex - 1); // drop `/api/conversations/<id>`
  const basePath = baseParts.length ? `/${baseParts.join('/')}` : '';
  const nested = `${url.origin}${basePath}`;
  return { nestedServerUrl: nested, conversationId: id };
}

function sanitizeErrorDetail(detail: string): string {
  if (!detail) return '';
  const trimmed = detail.trim();
  if (!trimmed) return '';
  const singleLine = trimmed.replace(/\s+/g, ' ');
  if (singleLine.length <= MAX_ERROR_DETAIL_CHARS) return singleLine;
  return `${singleLine.slice(0, MAX_ERROR_DETAIL_CHARS)}…`;
}

function formatUrlForError(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function buildAuthHeaders(cloudApiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${cloudApiKey}`,
    'Content-Type': 'application/json',
  };
}

async function fetchJsonWithTimeout(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function bootstrapCloudRemoteConversation(params: {
  saasServerUrl: string;
  cloudApiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<CloudBootstrapResult> {
  const normalized = normalizeServerUrl(params.saasServerUrl);
  if (!normalized.ok) {
    throw new Error(`Cloud bootstrap failed: invalid serverUrl (${normalized.error})`);
  }

  const cloudApiKey = params.cloudApiKey.trim();
  if (!cloudApiKey) {
    throw new Error('Cloud bootstrap failed: missing Cloud API Key');
  }

  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Cloud bootstrap failed: global fetch unavailable');
  }

  const timeoutMs = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
    ? Math.max(1000, Math.trunc(params.timeoutMs))
    : 120_000;

  const saasServerUrl = normalized.url.replace(/\/$/, '');
  const startUrl = `${saasServerUrl}/api/v1/app-conversations/stream-start`;
  const startRes = await fetchJsonWithTimeout(fetchFn, startUrl, {
    method: 'POST',
    headers: buildAuthHeaders(cloudApiKey),
    body: JSON.stringify({}),
  }, timeoutMs);

  if (!startRes.ok) {
    const detail = sanitizeErrorDetail(await startRes.text().catch(() => ''));
    const status = startRes.status;
    if (status === 401 || status === 403) {
      throw new Error(`Cloud bootstrap failed (HTTP ${status}): invalid or expired Cloud API Key.`);
    }
    if (status === 404) {
      throw new Error(`Cloud bootstrap failed (HTTP 404): server does not support V1 app-conversations.`);
    }
    throw new Error(`Cloud bootstrap failed (HTTP ${status})${detail ? `: ${detail}` : ''}`);
  }

  const tasks: unknown = await startRes.json().catch(() => null);
  if (!Array.isArray(tasks)) {
    throw new Error('Cloud bootstrap failed: invalid stream-start response (expected JSON array)');
  }

  const taskList = tasks as AppConversationStartTask[];
  let readyTask: AppConversationStartTask | undefined;
  for (let i = taskList.length - 1; i >= 0; i -= 1) {
    const task = taskList[i];
    if (task?.status !== 'READY') continue;
    if (typeof task.app_conversation_id !== 'string') continue;
    if (!task.app_conversation_id.trim()) continue;
    readyTask = task;
    break;
  }

  const appConversationId = typeof readyTask?.app_conversation_id === 'string' ? readyTask.app_conversation_id.trim() : '';
  if (!appConversationId) {
    let errorTask: AppConversationStartTask | undefined;
    for (let i = taskList.length - 1; i >= 0; i -= 1) {
      const task = taskList[i];
      if (task?.status === 'ERROR') {
        errorTask = task;
        break;
      }
    }
    const rawErrorDetail = typeof errorTask?.detail === 'string' ? errorTask.detail : '';
    const errorDetail = sanitizeErrorDetail(rawErrorDetail);
    throw new Error(`Cloud bootstrap failed: app conversation never reached READY${errorDetail ? ` (${errorDetail})` : ''}`);
  }

  const getUrl = `${saasServerUrl}/api/v1/app-conversations?ids=${encodeURIComponent(appConversationId)}`;
  const getRes = await fetchJsonWithTimeout(fetchFn, getUrl, {
    method: 'GET',
    headers: buildAuthHeaders(cloudApiKey),
  }, timeoutMs);

  if (!getRes.ok) {
    const detail = sanitizeErrorDetail(await getRes.text().catch(() => ''));
    const status = getRes.status;
    if (status === 401 || status === 403) {
      throw new Error(`Cloud bootstrap failed (HTTP ${status}): invalid or expired Cloud API Key.`);
    }
    throw new Error(`Cloud bootstrap failed fetching app conversation (HTTP ${status})${detail ? `: ${detail}` : ''}`);
  }

  const conversations: unknown = await getRes.json().catch(() => null);
  if (!Array.isArray(conversations)) {
    throw new Error('Cloud bootstrap failed: invalid app-conversations response (expected JSON array)');
  }

  const info = conversations.find((c): c is AppConversation => Boolean(c && typeof c === 'object'));
  const conversationUrl =
    typeof info?.conversation_url === 'string' && info.conversation_url.trim().length > 0 ? info.conversation_url.trim() : '';
  const runtimeSessionApiKey =
    typeof info?.session_api_key === 'string' && info.session_api_key.trim().length > 0 ? info.session_api_key.trim() : '';

  if (!conversationUrl) {
    throw new Error('Cloud bootstrap failed: response missing conversation_url');
  }
  if (!runtimeSessionApiKey) {
    throw new Error('Cloud bootstrap failed: response missing session_api_key');
  }

  const parsed = parseNestedConversationUrl(conversationUrl);
  if (!parsed) {
    throw new Error(`Cloud bootstrap failed: could not parse conversation_url (${formatUrlForError(conversationUrl)})`);
  }

  return {
    saasServerUrl,
    appConversationId,
    conversationUrl,
    nestedServerUrl: parsed.nestedServerUrl,
    conversationId: parsed.conversationId,
    runtimeSessionApiKey,
  };
}
