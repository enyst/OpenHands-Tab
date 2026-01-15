import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { WebviewHost } from '../createWebviewMessageHandler';
import { normalizeServerUrl } from '../../../shared/serverUrls';

type SettingsManagerLike = {
  get: () => Promise<{ servers: Array<{ url: string; label?: string }>; serverUrl?: string | null }>;
  update: (patch: Record<string, unknown>) => Promise<void>;
};

export async function handleSelectServer(args: {
  host: WebviewHost;
  settingsMgr: SettingsManagerLike;
  postStatusError: (message: string) => void;
  message: Extract<WebviewToHostMessage, { type: 'selectServer' }>;
}): Promise<void> {
  const rawUrl = typeof args.message.url === 'string' ? args.message.url.trim() : '';
  const url = rawUrl ? normalizeServerUrl(rawUrl) : { ok: true as const, url: '' };
  if (!url.ok) {
    args.postStatusError(url.error);
    return;
  }
  const currentSettings = await args.settingsMgr.get();

  const serverExists = currentSettings.servers.some((s) => s.url === url.url);
  if (!serverExists && url.url) {
    await args.settingsMgr.update({
      servers: [...currentSettings.servers, { url: url.url }],
      serverUrl: url.url,
    });
  } else {
    await args.settingsMgr.update({ serverUrl: url.url });
  }

  const updated = await args.settingsMgr.get();
  void args.host.postMessage({
    type: 'serverListUpdated',
    servers: updated.servers,
    serverUrl: updated.serverUrl ?? '',
  });
}

export async function handleAddServer(args: {
  host: WebviewHost;
  settingsMgr: SettingsManagerLike;
  postStatusError: (message: string) => void;
  message: Extract<WebviewToHostMessage, { type: 'addServer' }>;
}): Promise<void> {
  const server = args.message.server;
  if (!server?.url) return;

  const normalized = normalizeServerUrl(server.url);
  if (!normalized.ok) {
    args.postStatusError(normalized.error);
    return;
  }

  const label = typeof server.label === 'string' ? server.label.trim() : '';
  const canonicalServer = label ? { url: normalized.url, label } : { url: normalized.url };

  const currentSettings = await args.settingsMgr.get();
  const exists = currentSettings.servers.some((s) => s.url === normalized.url);
  if (!exists) {
    const newServers = [...currentSettings.servers, canonicalServer];
    await args.settingsMgr.update({ servers: newServers });
    void args.host.postMessage({
      type: 'serverListUpdated',
      servers: newServers,
      serverUrl: currentSettings.serverUrl ?? '',
    });
  }
}

export async function handleRemoveServer(args: {
  host: WebviewHost;
  settingsMgr: SettingsManagerLike;
  postStatusError: (message: string) => void;
  message: Extract<WebviewToHostMessage, { type: 'removeServer' }>;
}): Promise<void> {
  const rawUrl = typeof args.message.url === 'string' ? args.message.url.trim() : '';
  if (!rawUrl) return;

  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized.ok) {
    args.postStatusError(normalized.error);
    return;
  }
  const url = normalized.url;

  const currentSettings = await args.settingsMgr.get();
  const newServers = currentSettings.servers.filter((s) => s.url !== url);
  const newServerUrl = currentSettings.serverUrl === url ? '' : currentSettings.serverUrl;

  await args.settingsMgr.update({
    servers: newServers,
    serverUrl: newServerUrl,
  });

  void args.host.postMessage({
    type: 'serverListUpdated',
    servers: newServers,
    serverUrl: newServerUrl ?? '',
  });
}

export async function handleSwitchToLocal(args: {
  host: WebviewHost;
  settingsMgr: SettingsManagerLike;
}): Promise<void> {
  await args.settingsMgr.update({ serverUrl: '' });

  const updated = await args.settingsMgr.get();
  void args.host.postMessage({
    type: 'serverListUpdated',
    servers: updated.servers,
    serverUrl: '',
  });
}

