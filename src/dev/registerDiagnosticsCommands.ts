import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { renderCondensationSummarizingPrompt, takeLastTeleportableEvents, TELEPORT_FALLBACK_EVENT_LIMIT, TELEPORT_SUMMARY_EVENT_LIMIT } from '../shared/halTeleport';
import { DEFAULT_HAL_STATE } from '../shared/halDefaults';
import { safeStringify } from '../shared/safeStringify';
import type { HostToWebviewMessage } from '../shared/webviewMessages';
import type { ConversationEventBacklog, BufferedConversationEvent } from '../conversation/eventBacklog';
import type { HalStateSnapshot } from '../shared/halTypes';
import type { ConversationInstance, SecretRegistry, Event } from '@openhands/agent-sdk-ts';

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
};

type EnsureConversationAndConnection = (options?: { uiJustCreated?: boolean; modeSwitched?: boolean }) => Promise<void>;

type RenderError = (err: unknown) => string;

type ResolveGitContext = (workspaceRoot: string | undefined) => Promise<{ repoName: string; branchName: string }>;

type SummarizeWithLocalLlm = (settings: OpenHandsSettings, prompt: string, secrets: SecretRegistry) => Promise<string>;

type RegisterDiagnosticsCommandsDeps = {
  context: vscode.ExtensionContext;
  getChatView: () => vscode.WebviewView | undefined;
  getChatWebviewReady: () => boolean;
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
  printedExitFor: Map<string, true>;
  secretRegistry: SecretRegistry;
  getConversation: () => ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
  getTerminal: () => vscode.Terminal | undefined;
  getReceivedTerminalEventsCount: () => number;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: RenderError;
  resolveGitContext: ResolveGitContext;
  summarizeWithLocalLlm: SummarizeWithLocalLlm;
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

export function registerDiagnosticsCommands(deps: RegisterDiagnosticsCommandsDeps): vscode.Disposable[] {
  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? '';
  const diag = vscode.commands.registerCommand('openhands._diagnostics', () => {
    const chatView = deps.getChatView();
    const terminal = deps.getTerminal();

    return {
      chat: {
        hasView: !!chatView,
        visible: chatView?.visible ?? false,
        webviewReady: deps.getChatWebviewReady(),
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
      terminal: {
        hasTerminal: !!terminal,
        received: deps.getReceivedTerminalEventsCount(),
      },
    };
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
    if (typeof e.detail === 'string') payload.detail = e.detail;
    if (typeof e.error === 'string') payload.error = e.error;
    if (typeof e.tool_name === 'string') payload.tool_name = e.tool_name;
    if (typeof e.tool_call_id === 'string') payload.tool_call_id = e.tool_call_id;
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

  const teleportToRemoteRuntime = vscode.commands.registerCommand('openhands._teleportToRemoteRuntime', async () => {
    const postToWebview = (message: HostToWebviewMessage) => {
      const chatView = deps.getChatView();
      if (!chatView || !deps.getChatWebviewReady()) return false;
      void chatView.webview.postMessage(message);
      return true;
    };

    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
      const settings = await settingsMgr.get();

      const firstServerUrl = typeof settings.servers?.[0]?.url === 'string' ? settings.servers[0].url.trim() : '';
      if (!firstServerUrl) {
        const message = 'No server available';
        deps.getOutputChannel()?.appendLine(`[hal.teleport] ${message}`);
        const posted = postToWebview({ type: 'halTeleportUnavailable', error: message });
        if (!posted) {
          void vscode.window.showErrorMessage(message);
        }
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const { repoName, branchName } = await deps.resolveGitContext(workspaceRoot);
      const introLines = [
        'Teleported from the local VS Code runtime after a HIGH-risk confirmation.',
        `Repo: ${repoName}`,
        `Branch: ${branchName}`,
        'Note: uncommitted local changes may not be present remotely.',
      ];
      const intro = introLines.join('\n');

      const backlogEvents = Array.from(deps.iterConversationEventBacklog(), (item) => item.event);
      const summaryEvents = takeLastTeleportableEvents(backlogEvents, TELEPORT_SUMMARY_EVENT_LIMIT);
      const prompt = renderCondensationSummarizingPrompt({
        previousSummary: '',
        eventStrings: summaryEvents.map((e) => safeStringify(e)),
      });

      let firstRemoteMessage: string;
      try {
        const summary = await deps.summarizeWithLocalLlm(settings, prompt, deps.secretRegistry);
        firstRemoteMessage = `${intro}\n\n---\n\n${summary}`;
      } catch (err) {
        const last10 = takeLastTeleportableEvents(backlogEvents, TELEPORT_FALLBACK_EVENT_LIMIT).map((e) => safeStringify(e));
        const reason = deps.renderError(err);
        const block = last10.map((e) => `<EVENT>\n${e}\n</EVENT>`).join('\n\n');
        firstRemoteMessage = `${intro}\n\n---\n\nTeleport summary failed: ${reason}\n\nLast 10 events (Action/Observation/Message only):\n\n${block}`;
      }

      try {
        await deps.getConversation()?.rejectAction('Teleported to remote runtime');
      } catch (err) {
        deps.getOutputChannel()?.appendLine(`[hal.teleport] Failed to reject local confirmation: ${deps.renderError(err)}`);
      }

      // Ensure we always start a new remote conversation instead of restoring a prior one.
      await deps.context.workspaceState.update('openhands.conversationId.remote', undefined);

      await settingsMgr.update({ serverUrl: firstServerUrl });
      await deps.ensureConversationAndConnection({ uiJustCreated: true });
      deps.sentTestEvents.length = 0;
      deps.printedExitFor.clear();
      await deps.getConversation()?.startNewConversation();
      await deps.getConversation()?.sendUserMessage(firstRemoteMessage);
    } catch (err) {
      const reason = deps.renderError(err);
      deps.getOutputChannel()?.appendLine(`[hal.teleport] Teleport failed: ${reason}`);
      const posted = postToWebview({ type: 'halTeleportFailed', error: reason });
      if (!posted) {
        void vscode.window.showErrorMessage(`Teleport failed: ${reason}`);
      }
    }
  });

  return [
    diag,
    queryLastError,
    queryBacklogSummary,
    sendTestEvent,
    queryRenderedEvents,
    queryUiState,
    queryHalState,
    webviewAction,
    teleportToRemoteRuntime,
  ];
}

