import type * as vscode from 'vscode';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import { getDefaultLocalToolIds, listLocalToolDescriptors, normalizeLocalToolIds, resolveLocalTools, type LocalToolId } from '../../../shared/localTools';
import { isOpenHandsCloudServerUrl } from '../../../shared/cloudServers';
import { normalizeServerUrl } from '../../../shared/serverUrls';
import { isOpenHandsSettingsSecrets } from '../../../settings/SettingsManager';
import type { CreateWebviewMessageHandlerDeps, WebviewHost } from '../webviewMessageHandler.types';

type LocalConversationToolControls = {
  mode: 'local';
  getToolNames: () => string[];
  setTools: (tools: unknown[]) => void;
};

export const isLocalConversationToolControls = (value: unknown): value is LocalConversationToolControls => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LocalConversationToolControls> & { [k: string]: unknown };
  return candidate.mode === 'local'
    && typeof candidate.getToolNames === 'function'
    && typeof candidate.setTools === 'function';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeSecret = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const ensureRequiredLocalToolIds = (toolIds: LocalToolId[]): LocalToolId[] => {
  // `finish` is always enabled by the runtime agent (for safe termination).
  // Keep the UI/tool-selection source of truth consistent with what is actually sent to the LLM.
  if (toolIds.includes('finish')) return toolIds;
  return [...toolIds, 'finish'];
};

type RemoteToolListDeps = {
  serverUrl: string;
  cloudApiKey?: string;
  runtimeSessionApiKey?: string;
};

const getRemoteToolListDeps = (conversation: unknown): RemoteToolListDeps | null => {
  if (!conversation || typeof conversation !== 'object') return null;
  const candidate = conversation as { [k: string]: unknown };
  const serverUrl = candidate.serverUrl;
  if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) return null;

  const rawSettings = isRecord(candidate.settings) ? candidate.settings : undefined;
  const rawSecrets = rawSettings?.secrets;
  const secrets = isOpenHandsSettingsSecrets(rawSecrets) ? rawSecrets : undefined;

  const cloudApiKey = normalizeSecret(secrets?.cloudApiKey);

  const runtimeSessionApiKey = normalizeSecret(secrets?.runtimeSessionApiKey);
  return { serverUrl: serverUrl.trim(), cloudApiKey, runtimeSessionApiKey };
};

async function fetchRemoteToolNames(params: RemoteToolListDeps): Promise<string[] | null> {
  const normalized = normalizeServerUrl(params.serverUrl);
  if (!normalized.ok) return null;
  const url = `${normalized.url}/api/tools/`;
  const headers: Record<string, string> = {};
  if (isOpenHandsCloudServerUrl(normalized.url)) {
    if (params.cloudApiKey) headers['Authorization'] = `Bearer ${params.cloudApiKey}`;
  } else if (params.runtimeSessionApiKey) {
    headers['X-Session-API-Key'] = params.runtimeSessionApiKey;
  }

  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;

  const abortController = new AbortController();
  const timeoutMs = 4000;
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, { method: 'GET', headers, signal: abortController.signal });
    if (!res.ok) return null;
    const payload = await res.json();
    if (!Array.isArray(payload)) return null;

    const out: string[] = [];
    for (const tool of payload) {
      if (typeof tool !== 'string') continue;
      const trimmed = tool.trim();
      if (!trimmed) continue;
      out.push(trimmed);
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createPostToolsList(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
}): () => Promise<void> {
  return async (): Promise<void> => {
    const mode = args.deps.getConversationMode();
    if (mode !== 'local') {
      const conversation = args.deps.getConversation();
      const remoteDeps = getRemoteToolListDeps(conversation);
      const toolNames = remoteDeps ? await fetchRemoteToolNames(remoteDeps) : null;
      const tools = (toolNames ?? []).map((name) => ({ id: name, label: name }));
      void args.host.postMessage({ type: 'toolsList', tools, enabledToolIds: toolNames ?? [] });
      return;
    }

    const tools = listLocalToolDescriptors();
    const conversation = args.deps.getConversation();
    const enabledToolIds = (() => {
      if (isLocalConversationToolControls(conversation)) {
        const ids = normalizeLocalToolIds(conversation.getToolNames());
        if (ids !== null) return ids;
      }
      return getDefaultLocalToolIds();
    })();

    void args.host.postMessage({ type: 'toolsList', tools, enabledToolIds: ensureRequiredLocalToolIds(enabledToolIds) });
  };
}

export async function handleSetEnabledTools(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  outputChannel: vscode.OutputChannel | undefined;
  postStatusError: (message: string) => void;
  postToolsList: () => Promise<void>;
  message: Extract<WebviewToHostMessage, { type: 'setEnabledTools' }>;
}): Promise<void> {
  const mode = args.deps.getConversationMode();
  if (mode !== 'local') return;

  const normalized = normalizeLocalToolIds(args.message.toolIds);
  if (normalized === null) {
    args.postStatusError('Invalid tools selection received from webview');
    return;
  }

  const conversation = args.deps.getConversation();
  if (!isLocalConversationToolControls(conversation)) {
    args.postStatusError('Cannot update tools: conversation unavailable');
    return;
  }

  const toolIds = ensureRequiredLocalToolIds(normalized);
  try {
    conversation.setTools(resolveLocalTools(toolIds));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine(`[tools] Failed to update tools: ${reason}`);
    void args.host.postMessage({ type: 'statusMessage', level: 'info', message: reason, autoDismiss: true, autoDismissDelay: 4000 });
  }

  await args.postToolsList();
}
