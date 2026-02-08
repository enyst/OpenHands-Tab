import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { DEFAULT_HAL_STATE } from '../shared/halDefaults';
import { resolveConfiguredLlmLabel } from '../shared/llmProfiles';
import { maskSecretsInText } from '../shared/maskSecrets';
import { safeStringify } from '../shared/safeStringify';
import type { HostToWebviewMessage, WebviewE2EInfo } from '../shared/webviewMessages';
import type { ConversationEventBacklog, BufferedConversationEvent } from '../conversation/eventBacklog';
import type { HalStateSnapshot } from '../shared/halTypes';
import { getServerCloudApiKeySecretKey } from '../auth/serverCloudApiKeys';
import { getServerRuntimeSessionApiKeySecretKey } from '../auth/serverRuntimeSessionApiKeys';
import * as llmProfilesStore from '../webview/host/llmProfilesStore';
import { OpenHandsTerminalLogPseudoterminal } from '../terminal/OpenHandsTerminalLogPseudoterminal';
import { isBashEvent, isTextContent, type BashEvent, type ConversationInstance, type Event, type SecretRegistry } from '@smolpaws/agent-sdk';
import type { DiagnosticsInfo, LastUserMessageInfo, TerminalLogInfo } from './diagnosticsTypes';

export type { DiagnosticsInfo, LastUserMessageInfo, TerminalLogInfo } from './diagnosticsTypes';


export type RenderedEventsInfo = {
  count: number;
  eventTypes: string[];
  events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
};

export type UiStateSnapshot = {
  input: string;
  showContextPicker: boolean;
  showSkillsPopover: boolean;
  showHistory: boolean;
  workspaceFilesCount: number;
  selectedContextFiles: string[];
  skillsCount: number;
  attachmentsCount: number;
  hasWelcomeProviderKey: boolean;
  hasWelcomeGeminiKey: boolean;
  showWelcomeProviderKeyMessage: boolean;
  showWelcomeGeminiKeyMessage: boolean;
};

const DEFAULT_UI_STATE: UiStateSnapshot = {
  input: '',
  showContextPicker: false,
  showSkillsPopover: false,
  showHistory: false,
  workspaceFilesCount: 0,
  selectedContextFiles: [],
  skillsCount: 0,
  attachmentsCount: 0,
  hasWelcomeProviderKey: false,
  hasWelcomeGeminiKey: false,
  showWelcomeProviderKeyMessage: false,
  showWelcomeGeminiKeyMessage: false,
};

type EnsureConversationAndConnection = (options?: { uiJustCreated?: boolean; modeSwitched?: boolean }) => Promise<void>;

type RenderError = (err: unknown) => string;

type RegisterDiagnosticsCommandsDeps = {
  context: vscode.ExtensionContext;
  getChatView: () => vscode.WebviewView | undefined;
  getChatWebviewReady: () => boolean;
  getChatWebviewE2EReady: () => boolean;
  getChatWebviewE2EInfo: () => WebviewE2EInfo | null;
  getChatLastConversationId: () => string | undefined;
  getChatLastSeenSeq: () => number | undefined;
  eventBacklog: ConversationEventBacklog;
  iterConversationEventBacklog: () => Iterable<BufferedConversationEvent>;
  bufferConversationEvent: (event: Event) => number;
  sentTestEvents: Event[];
  maxTestEvents: number;
  pendingRenderedEventsRequests: Map<string, (info: RenderedEventsInfo) => void>;
  pendingUiStateRequests: Map<string, (info: UiStateSnapshot) => void>;
  pendingHalStateRequests: Map<string, (info: HalStateSnapshot) => void>;
  ensureConversationAndConnection: EnsureConversationAndConnection;
  secretRegistry: SecretRegistry;
  trackAgentEditedFile: (fsPath: string) => void;
  getConversation: () => ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
  getTerminal: () => vscode.Terminal | undefined;
  getTerminalLogPty: () => OpenHandsTerminalLogPseudoterminal | undefined;
  getReceivedTerminalEventsCount: () => number;
  getRecentTerminalEvents?: (max?: number) => Array<{ type?: string; timestamp: number }>;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: RenderError;
  onTerminalEvent: (event: BashEvent) => void;
};

let nextE2ERequestId = 0;
function nextRequestId(prefix: string): string {
  nextE2ERequestId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextE2ERequestId}`;
}

function createPendingResponse<T>(
  map: Map<string, (value: T) => void>,
  requestId: string,
  timeoutMs: number
): { promise: Promise<T | undefined>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T | undefined>((resolve) => {
    map.set(requestId, (value: T) => {
      if (timer) clearTimeout(timer);
      map.delete(requestId);
      resolve(value);
    });
    timer = setTimeout(() => {
      map.delete(requestId);
      resolve(undefined);
    }, timeoutMs);
  });

  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      map.delete(requestId);
    },
  };
}

const truncatePreview = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…(truncated)`;
};

export function sanitizeDiagnosticsText(text: string, params: { secretRegistry?: SecretRegistry; maxChars: number }): string {
  let redacted = text;
  try {
    const safe = safeStringify(text);
    if (!safe.startsWith('<unserializable')) {
      const parsed = JSON.parse(safe) as unknown;
      if (typeof parsed === 'string') redacted = parsed;
    }
  } catch {
    // Best-effort only; fall back to original text.
  }
  const masked = maskSecretsInText(redacted, params.secretRegistry);
  return masked.length > params.maxChars ? truncatePreview(masked, params.maxChars) : masked;
}

export function registerDiagnosticsCommands(deps: RegisterDiagnosticsCommandsDeps): vscode.Disposable[] {
  const postToWebview = async (message: HostToWebviewMessage): Promise<boolean> => {
    const chatView = deps.getChatView();
    if (!chatView || !deps.getChatWebviewReady()) return false;
    return chatView.webview.postMessage(message);
  };

  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => {
    const inspected = vscode.workspace.getConfiguration().inspect<string>('openhands.serverUrl');
    return typeof inspected?.globalValue === 'string' ? inspected.globalValue : '';
  };

  const getServers = () => {
    const inspected = vscode.workspace.getConfiguration().inspect<OpenHandsSettings['servers']>('openhands.servers');
    return inspected?.globalValue ?? [];
  };

  const diag = vscode.commands.registerCommand('openhands._diagnostics', (): DiagnosticsInfo => {
    const chatView = deps.getChatView();
    const terminal = deps.getTerminal();
    const terminalPty = deps.getTerminalLogPty();

    const terminalInfo: TerminalLogInfo = {
      hasTerminal: !!terminal,
      received: deps.getReceivedTerminalEventsCount(),
      lastEvents: deps.getRecentTerminalEvents?.(10),
    };
    if (terminalPty) {
      terminalInfo.ptyOpened = terminalPty.isOpened();
      terminalInfo.preopenBufferedChars = terminalPty.getPreopenBufferedChars();
      terminalInfo.preopenDroppedChars = terminalPty.getPreopenDroppedChars();
    }

    return {
      chat: {
        hasView: !!chatView,
        visible: chatView?.visible ?? false,
        webviewReady: deps.getChatWebviewReady(),
        e2eReady: deps.getChatWebviewE2EReady(),
        e2eInfo: deps.getChatWebviewE2EInfo(),
        clientConversationId: deps.getChatLastConversationId(),
        clientLastSeenSeq: deps.getChatLastSeenSeq(),
      },
      eventBacklog: {
        activeConversationId: deps.eventBacklog.getConversationId(),
        size: deps.eventBacklog.getSize(),
        latestSeq: deps.eventBacklog.getLatestSeq() ?? 0,
      },
      hasConversation: !!deps.getConversation(),
      conversationId: deps.getConversation()?.getConversationId(),
      status: deps.getConversation()?.getStatus(),
      mode: deps.getConversationMode(),
      serverUrl: getServerUrl(),
      servers: getServers(),
      terminal: terminalInfo,
    };
  });

  // Internal: deterministic server config commands for E2E + debugging.
  const serversGet = vscode.commands.registerCommand('openhands._serversGet', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    const settings = await settingsMgr.get();
    return { serverUrl: settings.serverUrl ?? '', servers: settings.servers ?? [] };
  });

  const serversSet = vscode.commands.registerCommand('openhands._serversSet', async (raw: unknown) => {
    const payload = raw as { serverUrl?: unknown; servers?: unknown } | undefined;
    const serverUrl = typeof payload?.serverUrl === 'string' ? payload.serverUrl : '';
    const servers: OpenHandsSettings['servers'] = Array.isArray(payload?.servers)
      ? payload.servers.flatMap((s) => {
          if (typeof s === 'string') {
            const trimmed = s.trim();
            return trimmed ? [{ url: trimmed }] : [];
          }
          if (typeof s !== 'object' || s === null) return [];
          const record = s as Record<string, unknown>;
          const url = typeof record.url === 'string' ? record.url.trim() : '';
          if (!url) return [];
          const label = typeof record.label === 'string' ? record.label.trim() : undefined;
          return [{ url, label: label || undefined }];
        })
      : [];
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    await settingsMgr.update({ serverUrl, servers }, 'global');
    const updated = await settingsMgr.get();
    return { serverUrl: updated.serverUrl ?? '', servers: updated.servers ?? [] };
  });

  const extensionMode = vscode.ExtensionMode;
  const isTestMode =
    extensionMode?.Test !== undefined &&
    deps.context.extensionMode === extensionMode.Test;

  const e2eSetServerCloudApiKey = isTestMode
    ? vscode.commands.registerCommand('openhands._e2eSetServerCloudApiKey', async (raw: unknown) => {
        const payload = raw as { serverUrl?: unknown; apiKey?: unknown } | undefined;
        const serverUrl = typeof payload?.serverUrl === 'string' ? payload.serverUrl.trim() : '';
        const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';

        if (!serverUrl) return { ok: false, error: 'Missing serverUrl' };

        const info = getServerCloudApiKeySecretKey(serverUrl);
        if (!info.ok) return { ok: false, error: info.error };

        if (!apiKey) {
          await deps.context.secrets.delete(info.secretKey);
          deps.secretRegistry.set(info.secretKey, undefined);
          return { ok: true, cleared: true };
        }

        await deps.context.secrets.store(info.secretKey, apiKey);
        deps.secretRegistry.set(info.secretKey, apiKey);
        return { ok: true, stored: true };
      })
    : undefined;

  const e2eSetServerRuntimeSessionApiKey = isTestMode
    ? vscode.commands.registerCommand('openhands._e2eSetServerRuntimeSessionApiKey', async (raw: unknown) => {
        const payload = raw as { serverUrl?: unknown; apiKey?: unknown } | undefined;
        const serverUrl = typeof payload?.serverUrl === 'string' ? payload.serverUrl.trim() : '';
        const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';

        if (!serverUrl) return { ok: false, error: 'Missing serverUrl' };

        const info = getServerRuntimeSessionApiKeySecretKey(serverUrl);
        if (!info.ok) return { ok: false, error: info.error };

        if (!apiKey) {
          await deps.context.secrets.delete(info.secretKey);
          deps.secretRegistry.set(info.secretKey, undefined);
          return { ok: true, cleared: true };
        }

        await deps.context.secrets.store(info.secretKey, apiKey);
        deps.secretRegistry.set(info.secretKey, apiKey);
        return { ok: true, stored: true };
      })
    : undefined;
  const e2eSessionApiKeyStatus = isTestMode && process.env.E2E_CLOUD_LOGIN === '1'
    ? vscode.commands.registerCommand('openhands._e2eGetServerSessionApiKeyStatus', async (raw: unknown) => {
        const payload = raw as { serverUrl?: unknown } | undefined;
        const payloadUrl = typeof payload?.serverUrl === 'string' ? payload.serverUrl.trim() : '';
        const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
        const settings = await settingsMgr.get();
        const serverUrl = payloadUrl || (typeof settings.serverUrl === 'string' ? settings.serverUrl.trim() : '');

        if (!serverUrl) return { ok: false, error: 'Missing serverUrl' };

        const cloudKeyInfo = getServerCloudApiKeySecretKey(serverUrl);
        if (!cloudKeyInfo.ok) return { ok: false, error: cloudKeyInfo.error };
        const runtimeKeyInfo = getServerRuntimeSessionApiKeySecretKey(serverUrl);
        if (!runtimeKeyInfo.ok) return { ok: false, error: runtimeKeyInfo.error };

        const readTrimmed = async (key: string): Promise<string> => {
          try {
            const raw = await deps.context.secrets.get(key);
            return typeof raw === 'string' ? raw.trim() : '';
          } catch {
            return '';
          }
        };

        const cloudToken = await readTrimmed(cloudKeyInfo.secretKey);
        const runtimeToken = await readTrimmed(runtimeKeyInfo.secretKey);

        return {
          ok: true,
          normalizedServerUrl: cloudKeyInfo.normalizedServerUrl,
          hasCloudApiKey: Boolean(cloudToken),
          hasRuntimeSessionApiKey: Boolean(runtimeToken),
        };
      })
    : undefined;

  const serversReset = vscode.commands.registerCommand('openhands._serversReset', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    await settingsMgr.update({ serverUrl: '', servers: [] }, 'global');
    return { ok: true };
  });

  // Internal: return the last error event from the buffered backlog (for E2E + debugging).
  const queryLastError = vscode.commands.registerCommand('openhands._queryLastError', () => {
    let last: { seq: number; event: Event } | undefined;
    for (const item of deps.iterConversationEventBacklog()) {
      if (item.event.kind === 'ConversationErrorEvent' || item.event.kind === 'AgentErrorEvent') {
        last = { seq: item.seq, event: item.event };
      }
    }
    if (!last) return null;

    const e = last.event as unknown as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      seq: last.seq,
      kind: e.kind,
      source: e.source,
    };
    if (typeof e.code === 'string') payload.code = e.code;
    if (typeof e.detail === 'string') payload.detail = sanitizeDiagnosticsText(e.detail, { secretRegistry: deps.secretRegistry, maxChars: 4000 });
    if (typeof e.error === 'string') payload.error = sanitizeDiagnosticsText(e.error, { secretRegistry: deps.secretRegistry, maxChars: 4000 });
    if (typeof e.tool_name === 'string') payload.tool_name = e.tool_name;
    if (typeof e.tool_call_id === 'string') payload.tool_call_id = e.tool_call_id;
    return payload;
  });

  // Internal: return the last observation event from the buffered backlog (for E2E + debugging).
  const queryLastObservation = vscode.commands.registerCommand('openhands._queryLastObservation', (raw?: unknown) => {
    const toolNameFilter =
      typeof (raw as { tool_name?: unknown } | undefined)?.tool_name === 'string'
        ? ((raw as { tool_name: string }).tool_name).trim()
        : '';

    let last: { seq: number; event: Event } | undefined;
    for (const item of deps.iterConversationEventBacklog()) {
      if (item.event.kind !== 'ObservationEvent') continue;
      if (toolNameFilter) {
        const toolName = (item.event as unknown as { tool_name?: unknown }).tool_name;
        if (toolName !== toolNameFilter) continue;
      }
      last = { seq: item.seq, event: item.event };
    }

    if (!last) return null;

    const e = last.event as unknown as Record<string, unknown>;
    const observation = e.observation;
    const observationText = (() => {
      if (typeof observation === 'string') return observation;
      try {
        return safeStringify(observation);
      } catch {
        return String(observation);
      }
    })();

    const payload: Record<string, unknown> = {
      seq: last.seq,
      kind: e.kind,
      source: e.source,
      tool_name: e.tool_name,
      tool_call_id: e.tool_call_id,
      observationText: sanitizeDiagnosticsText(observationText, { secretRegistry: deps.secretRegistry, maxChars: 4000 }),
    };

    return payload;
  });

  // Internal: summarize the in-memory event backlog for deterministic E2E checks.
  const queryBacklogSummary = vscode.commands.registerCommand('openhands._queryBacklogSummary', () => {
    let lastEventKind: string | undefined;
    let lastEventSeq: number | undefined;
    let lastAssistantMessageSeq: number | undefined;
    let lastUserMessageSeq: number | undefined;

    for (const item of deps.iterConversationEventBacklog()) {
      lastEventKind = item.event.kind;
      lastEventSeq = item.seq;

      if (item.event.kind === 'MessageEvent') {
        const role = (item.event as unknown as { llm_message?: { role?: unknown } }).llm_message?.role;
        if (role === 'assistant') lastAssistantMessageSeq = item.seq;
        if (role === 'user') lastUserMessageSeq = item.seq;
      }
    }

    return {
      activeConversationId: deps.eventBacklog.getConversationId(),
      size: deps.eventBacklog.getSize(),
      latestSeq: deps.eventBacklog.getLatestSeq() ?? 0,
      lastEventSeq,
      lastEventKind,
      lastUserMessageSeq,
      lastAssistantMessageSeq,
    };
  });

  const queryLastUserMessage = vscode.commands.registerCommand('openhands._queryLastUserMessage', (): LastUserMessageInfo => {
    let last: { seq: number; event: Extract<Event, { kind: 'MessageEvent' }> } | undefined;
    for (const item of deps.iterConversationEventBacklog()) {
      if (item.event.kind !== 'MessageEvent') continue;
      if (item.event.source !== 'user') continue;
      last = { seq: item.seq, event: item.event };
    }
    if (!last) return null;

    const contentText = last.event.llm_message.content.filter(isTextContent).map((c) => c.text).join('\n');
    const extended = last.event.extended_content ?? [];
    const extendedText = extended.map((c) => c.text).join('\n');
    const maxChars = 400;
    const maskedContentText = maskSecretsInText(contentText, deps.secretRegistry);
    const maskedExtendedText = maskSecretsInText(extendedText, deps.secretRegistry);

    return {
      seq: last.seq,
      contentTextPreview: truncatePreview(maskedContentText, maxChars),
      extendedContentTextPreview: truncatePreview(maskedExtendedText, maxChars),
      extendedContentCount: extended.length,
    };
  });

  // Test command to send mock events to webview for E2E testing
  const sendTestEvent = vscode.commands.registerCommand('openhands._sendTestEvent', (event: Event) => {


    deps.sentTestEvents.push(event);
    if (deps.sentTestEvents.length > deps.maxTestEvents) {
      deps.sentTestEvents.splice(0, deps.sentTestEvents.length - deps.maxTestEvents);
    }
    const seq = deps.bufferConversationEvent(event);
    const chatView = deps.getChatView();
    if (chatView) {
      const payload: { type: 'event'; event: Event; seq?: number } = { type: 'event', event };
      if (typeof seq === 'number') payload.seq = seq;
      void chatView.webview.postMessage(payload satisfies HostToWebviewMessage);
    }
    return { sent: true, buffered: true, seq };
  });

  // Query rendered events from webview for E2E testing
  const queryRenderedEvents = vscode.commands.registerCommand('openhands._queryRenderedEvents', async () => {
    const chatView = deps.getChatView();
    if (!chatView) {
      return { count: 0, eventTypes: [] };
    }

    void chatView.show?.(true);
    const requestId = nextRequestId('renderedEvents');
    const pending = createPendingResponse(deps.pendingRenderedEventsRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryRenderedEvents', requestId } satisfies HostToWebviewMessage);
    if (!posted) {
      pending.cancel();
      return { count: 0, eventTypes: [] };
    }

    const info = await pending.promise;
    if (info) return info;

    // Fallback: if webview didn't respond (e.g., not yet ready), assume events equal to sentTestEvents
    const filtered = deps.sentTestEvents.filter((e) => e.kind !== 'ConversationStateUpdateEvent');
    const types = filtered.map((e) => e.kind ?? 'unknown');
    return { count: types.length, eventTypes: types };
  });

  // Query UI state from webview for E2E testing (toolbar + popovers)
  const queryUiState = vscode.commands.registerCommand('openhands._queryUiState', async () => {
    const chatView = deps.getChatView();
    if (!chatView) {
      return DEFAULT_UI_STATE;
    }

    void chatView.show?.(true);
    const requestId = nextRequestId('uiState');
    const pending = createPendingResponse(deps.pendingUiStateRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryUiState', requestId } satisfies HostToWebviewMessage);
    if (!posted) {
      pending.cancel();
      return DEFAULT_UI_STATE;
    }

    return (await pending.promise) ?? DEFAULT_UI_STATE;
  });

  // Query HAL presentation state from webview for E2E testing (no DOM automation)
  const queryHalState = vscode.commands.registerCommand('openhands._queryHalState', async () => {
    const chatView = deps.getChatView();
    if (!chatView) {
      return DEFAULT_HAL_STATE;
    }

    void chatView.show?.(true);
    const requestId = nextRequestId('halState');
    const pending = createPendingResponse(deps.pendingHalStateRequests, requestId, 5000);
    const posted = await chatView.webview.postMessage({ type: 'queryHalState', requestId } satisfies HostToWebviewMessage);
    if (!posted) {
      pending.cancel();
      return DEFAULT_HAL_STATE;
    }

    return (await pending.promise) ?? DEFAULT_HAL_STATE;
  });

  // Send a test action to the webview for E2E testing (UI flows without DOM automation)
  const webviewAction = vscode.commands.registerCommand(
    'openhands._webviewAction',
    async (req: { action: string; payload?: unknown } | undefined) => {
      const chatView = deps.getChatView();
      if (!chatView) return { sent: false };
      if (!req || typeof req.action !== 'string' || req.action.length === 0) return { sent: false };
      void chatView.show?.(true);
      const sent = await chatView.webview.postMessage({ type: 'e2eAction', action: req.action, payload: req.payload } satisfies HostToWebviewMessage);
      return { sent };
    }
  );

  const getProfileApiKeySecretKey = (profileId: string): string => `openhands.llmProfileApiKey.${profileId}`;

  const broadcastLlmProfilesUpdated = async (): Promise<void> => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    const settings = await settingsMgr.get();
    await postToWebview({
      type: 'llmProfilesUpdated',
      profiles: llmProfilesStore.listProfiles(),
      activeProfileId: settings.llm.profileId ?? null,
    });
  };

  const openProfilesView = vscode.commands.registerCommand('openhands._openProfilesView', async (raw: unknown) => {
    await vscode.commands.executeCommand('openhands.open');
    await deps.ensureConversationAndConnection({ uiJustCreated: true });

    const mode = (raw as { mode?: unknown } | undefined)?.mode;
    const profileIdRaw = (raw as { profileId?: unknown } | undefined)?.profileId;
    const payload: Record<string, unknown> = {};
    if (mode === 'create' || mode === 'edit') payload.mode = mode;
    if (typeof profileIdRaw === 'string') payload.profileId = profileIdRaw;

    return await vscode.commands.executeCommand('openhands._webviewAction', { action: 'openLlmProfilesView', payload });
  });

  const createProfile = vscode.commands.registerCommand('openhands._createProfile', async (raw: unknown) => {
    const profileId = typeof (raw as { profileId?: unknown } | undefined)?.profileId === 'string'
      ? ((raw as { profileId: string }).profileId).trim()
      : '';
    if (!profileId) throw new Error('profileId is required');
    const profile = (raw as { profile?: unknown } | undefined)?.profile;
    if (profile === undefined) throw new Error('profile is required');

    const existing = llmProfilesStore.listProfiles();
    if (existing.includes(profileId)) throw new Error(`Profile '${profileId}' already exists`);

    llmProfilesStore.saveProfile(profileId, profile);
    await broadcastLlmProfilesUpdated();
    return { ok: true, profileId };
  });

  const updateProfile = vscode.commands.registerCommand('openhands._updateProfile', async (raw: unknown) => {
    const profileId = typeof (raw as { profileId?: unknown } | undefined)?.profileId === 'string'
      ? ((raw as { profileId: string }).profileId).trim()
      : '';
    if (!profileId) throw new Error('profileId is required');
    const profile = (raw as { profile?: unknown } | undefined)?.profile;
    const patch = (raw as { patch?: unknown } | undefined)?.patch;

    const existing = llmProfilesStore.listProfiles();
    if (!existing.includes(profileId)) throw new Error(`Profile '${profileId}' not found`);

    if (profile !== undefined) {
      llmProfilesStore.saveProfile(profileId, profile);
      await broadcastLlmProfilesUpdated();
      return { ok: true, profileId };
    }

    if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');
    const current = llmProfilesStore.loadProfile(profileId).config;
    const next = { ...current, ...(patch as Record<string, unknown>) };
    llmProfilesStore.saveProfile(profileId, next);
    await broadcastLlmProfilesUpdated();
    return { ok: true, profileId };
  });

  const deleteProfile = vscode.commands.registerCommand('openhands._deleteProfile', async (raw: unknown) => {
    const profileId = typeof (raw as { profileId?: unknown } | undefined)?.profileId === 'string'
      ? ((raw as { profileId: string }).profileId).trim()
      : '';
    if (!profileId) throw new Error('profileId is required');

    const existing = llmProfilesStore.listProfiles();
    if (!existing.includes(profileId)) throw new Error(`Profile '${profileId}' not found`);

    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    const before = await settingsMgr.get();
    const activeProfileId = before.llm.profileId ?? null;

    llmProfilesStore.deleteProfile(profileId);
    const apiKeySecretKey = getProfileApiKeySecretKey(profileId);
    await deps.context.secrets.delete(apiKeySecretKey);
    deps.secretRegistry.set(apiKeySecretKey, undefined);

    const clearedSelection = activeProfileId === profileId;
    if (clearedSelection) {
      await settingsMgr.update({ llm: { profileId: '' } }, 'global');
      await deps.ensureConversationAndConnection();
    }

    await broadcastLlmProfilesUpdated();
    return { ok: true, profileId, clearedSelection };
  });

  const selectProfile = vscode.commands.registerCommand('openhands._selectProfile', async (raw: unknown) => {
    const nestedProfileId = (raw as { profileId?: unknown } | undefined)?.profileId;
    const profileIdRaw = nestedProfileId === undefined ? raw : nestedProfileId;
    if (profileIdRaw !== null && typeof profileIdRaw !== 'string') {
      throw new Error('profileId must be a string or null');
    }
    const profileId = typeof profileIdRaw === 'string' ? profileIdRaw.trim() : '';

    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
    await settingsMgr.update({ llm: { profileId } }, 'global');
    await deps.ensureConversationAndConnection();

    const updated = await settingsMgr.get();
    const label = resolveConfiguredLlmLabel(updated);
    await postToWebview({
      type: 'status',
      status: deps.getConversation()?.getStatus() ?? 'offline',
      mode: deps.getConversationMode(),
      llmProfileLabel: label,
    });
    await broadcastLlmProfilesUpdated();
    return { ok: true, profileId: updated.llm.profileId ?? null };
  });

  const setProfileApiKey = vscode.commands.registerCommand('openhands._setProfileApiKey', async (raw: unknown) => {
    const profileId = typeof (raw as { profileId?: unknown } | undefined)?.profileId === 'string'
      ? ((raw as { profileId: string }).profileId).trim()
      : '';
    if (!profileId) throw new Error('profileId is required');
    const apiKeyRaw = (raw as { apiKey?: unknown } | undefined)?.apiKey;
    const apiKey = typeof apiKeyRaw === 'string' ? apiKeyRaw.trim() : '';

    const key = getProfileApiKeySecretKey(profileId);
    if (!apiKey) {
      await deps.context.secrets.delete(key);
      deps.secretRegistry.set(key, undefined);
      return { ok: true, profileId, hasKey: false };
    }
    await deps.context.secrets.store(key, apiKey);
    deps.secretRegistry.set(key, apiKey);
    return { ok: true, profileId, hasKey: true };
  });

  const setProviderApiKey = vscode.commands.registerCommand('openhands._setProviderApiKey', async (raw: unknown) => {
    const providerRaw = (raw as { provider?: unknown } | undefined)?.provider;
    if (typeof providerRaw !== 'string') throw new Error('provider is required');
    const provider = providerRaw.trim();
    if (!['openai', 'anthropic', 'openrouter', 'litellm_proxy', 'gemini'].includes(provider)) {
      throw new Error('provider must be one of: openai, anthropic, openrouter, litellm_proxy, gemini');
    }
    const apiKeyRaw = (raw as { apiKey?: unknown } | undefined)?.apiKey;
    const apiKey = typeof apiKeyRaw === 'string' ? apiKeyRaw.trim() : '';

    const key = (() => {
      switch (provider) {
        case 'openrouter':
          return 'OPENROUTER_API_KEY';
        case 'litellm_proxy':
          return 'LITELLM_API_KEY';
        case 'anthropic':
          return 'ANTHROPIC_API_KEY';
        case 'gemini':
          return 'GEMINI_API_KEY';
        default:
          return 'OPENAI_API_KEY';
      }
    })();

    if (!apiKey) {
      await deps.context.secrets.delete(key);
      deps.secretRegistry.set(key, undefined);
      return { ok: true, provider, key, hasKey: false };
    }

    await deps.context.secrets.store(key, apiKey);
    deps.secretRegistry.set(key, apiKey);
    return { ok: true, provider, key, hasKey: true };
  });

  const listProfiles = vscode.commands.registerCommand('openhands._listProfiles', () => {
    return { profiles: llmProfilesStore.listProfiles() };
  });

  const injectTerminalEvent = vscode.commands.registerCommand('openhands._injectTerminalEvent', (raw: unknown) => {
    if (!isBashEvent(raw)) {
      return { injected: false, error: 'Invalid BashEvent structure' };
    }

    try {
      deps.onTerminalEvent(raw);
      return { injected: true };
    } catch (err) {
      return { injected: false, error: deps.renderError(err) };
    }
  });

  const testMarkAgentEditedFile = vscode.commands.registerCommand('openhands._testMarkAgentEditedFile', (raw: unknown) => {
    const fsPathRaw = (raw as { fsPath?: unknown } | undefined)?.fsPath;
    const fsPath = typeof fsPathRaw === 'string' ? fsPathRaw.trim() : '';
    if (!fsPath) throw new Error('fsPath is required');

    if (deps.getConversationMode() !== 'local') return { ok: true };
    deps.trackAgentEditedFile(fsPath);
    return { ok: true };
  });

  const disposables: vscode.Disposable[] = [
    diag,
    serversGet,
    serversSet,
    serversReset,
    queryLastError,
    queryLastObservation,
    queryBacklogSummary,
    queryLastUserMessage,
    sendTestEvent,
    queryRenderedEvents,
    queryUiState,
    queryHalState,
    webviewAction,
    openProfilesView,
    createProfile,
    updateProfile,
    deleteProfile,
    selectProfile,
    setProfileApiKey,
    setProviderApiKey,
    listProfiles,
    injectTerminalEvent,
    testMarkAgentEditedFile,
  ];

  if (e2eSessionApiKeyStatus) {
    disposables.push(e2eSessionApiKeyStatus);
  }
  if (e2eSetServerCloudApiKey) {
    disposables.push(e2eSetServerCloudApiKey);
  }
  if (e2eSetServerRuntimeSessionApiKey) {
    disposables.push(e2eSetServerRuntimeSessionApiKey);
  }

  return disposables;
}
