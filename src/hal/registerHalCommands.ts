import * as vscode from 'vscode';
import { SettingsManager, type OpenHandsSettings } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { renderCondensationSummarizingPrompt, takeLastTeleportableEvents, TELEPORT_FALLBACK_EVENT_LIMIT, TELEPORT_SUMMARY_EVENT_LIMIT } from '../shared/halTeleport';
import { safeStringify } from '../shared/safeStringify';
import type { HostToWebviewMessage } from '../shared/webviewMessages';
import type { BufferedConversationEvent } from '../conversation/eventBacklog';
import type { ConversationInstance, Event, SecretRegistry } from '@openhands/agent-sdk-ts';

type EnsureConversationAndConnection = (options?: { uiJustCreated?: boolean; modeSwitched?: boolean }) => Promise<void>;

type RenderError = (err: unknown) => string;

type ResolveGitContext = (workspaceRoot: string | undefined) => Promise<{ repoName: string; branchName: string; remoteUrl: string }>;

type SummarizeWithLocalLlm = (settings: OpenHandsSettings, prompt: string, secrets: SecretRegistry) => Promise<string>;

export type RegisterHalCommandsDeps = {
  context: vscode.ExtensionContext;
  getChatView: () => vscode.WebviewView | undefined;
  getChatWebviewReady: () => boolean;
  iterConversationEventBacklog: () => Iterable<BufferedConversationEvent>;
  sentTestEvents: Event[];
  ensureConversationAndConnection: EnsureConversationAndConnection;
  printedExitFor: Map<string, true>;
  secretRegistry: SecretRegistry;
  getConversation: () => ConversationInstance | undefined;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: RenderError;
  resolveGitContext: ResolveGitContext;
  summarizeWithLocalLlm: SummarizeWithLocalLlm;
};

/**
 * Formats teleport error messages to be more user-friendly.
 * Converts technical error messages into short, actionable guidance.
 */
export function formatTeleportError(rawError: string): string {
  const lower = rawError.toLowerCase();

  // Node fetch failures (common for localhost when server isn't running)
  if (lower.includes('fetch failed') || lower.includes('failed to fetch')) {
    return 'Server unreachable. Check if it is running.';
  }

  // Connection refused / unreachable
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return 'Server unreachable. Check if it is running.';
  }

  // Timeout errors
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('timed out')) {
    return 'Connection timed out. Server may be down.';
  }

  // DNS resolution failures
  if (lower.includes('enotfound') || lower.includes('getaddrinfo') || lower.includes('dns')) {
    return 'Server not found. Check the URL.';
  }

  // Network unreachable
  if (lower.includes('enetunreach') || lower.includes('network unreachable')) {
    return 'Network unreachable. Check your connection.';
  }

  // SSL/TLS errors
  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate')) {
    return 'SSL/TLS error. Invalid certificate?';
  }

  // Connection reset
  if (lower.includes('econnreset') || lower.includes('connection reset')) {
    return 'Connection reset. Try again.';
  }

  // WebSocket errors
  if (lower.includes('websocket') || lower.includes('ws://') || lower.includes('wss://')) {
    return 'WebSocket failed. Server not accepting connections.';
  }

  // Return original if no pattern matched
  return rawError;
}

export function registerHalCommands(deps: RegisterHalCommandsDeps): vscode.Disposable[] {
  const postToWebview = async (message: HostToWebviewMessage): Promise<boolean> => {
    const chatView = deps.getChatView();
    if (!chatView || !deps.getChatWebviewReady()) return false;
    return chatView.webview.postMessage(message);
  };

  const isAbortError = (err: unknown): boolean => {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    if (err instanceof Error && err.name === 'AbortError') return true;
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return /aborterror/i.test(text) || /aborted/i.test(text);
  };

  const HEALTHCHECK_TIMEOUT_MS = 2500;

  const checkServerHealth = async (serverUrl: string, signal: AbortSignal): Promise<void> => {
    const normalized = serverUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetch(`${normalized}/health`, { method: 'GET', signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Health check failed (${res.status})`);
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  };

  let activeTeleport: { abort: AbortController; didCancel: boolean } | null = null;

  const cancelTeleportToRemoteRuntime = vscode.commands.registerCommand('openhands._cancelTeleportToRemoteRuntime', () => {
    if (!activeTeleport) return;
    activeTeleport.didCancel = true;
    try {
      activeTeleport.abort.abort();
    } catch {}

    // Keep behavior simple: cancel only affects the HAL UI/UX.
    // We do NOT try to unwind in-flight connection/retry loops here.
    void postToWebview({ type: 'halTeleportCanceled' });
  });

  const teleportToRemoteRuntime = vscode.commands.registerCommand('openhands._teleportToRemoteRuntime', async () => {
    let targetServerUrl: string | undefined;
    let targetServerLabel: string | undefined;
    let connectionEstablished = false;
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));

    try {
      if (activeTeleport) {
        deps.getOutputChannel()?.appendLine('[hal.teleport] Teleport already in progress');
        return;
      }
      const abort = new AbortController();
      activeTeleport = { abort, didCancel: false };

      const settings = await settingsMgr.get();

      const firstServer = settings.servers?.[0];
      const firstServerUrl = typeof firstServer?.url === 'string' ? firstServer.url.trim() : '';
      if (!firstServerUrl) {
        const message = 'No server configured. Add one in Server Selection.';
        deps.getOutputChannel()?.appendLine(`[hal.teleport] ${message}`);
        const posted = await postToWebview({ type: 'halTeleportUnavailable', error: message });
        if (!posted) {
          void vscode.window.showErrorMessage(message);
        }
        return;
      }

      targetServerUrl = firstServerUrl;
      targetServerLabel = typeof firstServer?.label === 'string' ? firstServer.label.trim() : undefined;
      const serverDisplayName = targetServerLabel || targetServerUrl;

      // Notify webview that teleport is starting with server info
      await postToWebview({
        type: 'halTeleportStarting',
        serverUrl: targetServerUrl,
        serverLabel: targetServerLabel,
      });

      // Fast liveness check to avoid long reconnect loops when the server is down.
      // (RemoteConversation retries can keep the HAL waiting screen/music going for a long time.)
      try {
        await checkServerHealth(targetServerUrl, abort.signal);
      } catch (err) {
        if (isAbortError(err)) return;
        throw err;
      }

      // STEP 1: Try to connect to the remote server FIRST
      // This must succeed before we do anything else (reject local action, prepare summary, etc.)
      deps.getOutputChannel()?.appendLine(`[hal.teleport] Attempting connection to ${serverDisplayName}...`);

      // Ensure we always start a new remote conversation instead of restoring a prior one.
      await deps.context.workspaceState.update('openhands.conversationId.remote', undefined);

      await settingsMgr.update({ serverUrl: targetServerUrl });
      await deps.ensureConversationAndConnection({ uiJustCreated: true });

      // Connection succeeded - mark it so we know we can proceed
      connectionEstablished = true;
      deps.getOutputChannel()?.appendLine(`[hal.teleport] Connection established to ${serverDisplayName}`);

      // STEP 2: Now that connection is established, reject the local action
      // This is safe because we know the remote server is available
      try {
        await deps.getConversation()?.rejectAction('Teleported to remote runtime');
      } catch (err) {
        deps.getOutputChannel()?.appendLine(`[hal.teleport] Failed to reject local confirmation: ${deps.renderError(err)}`);
      }

      // STEP 3: Prepare the summary message (only after connection is established)
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const { repoName, branchName, remoteUrl } = await deps.resolveGitContext(workspaceRoot);
      const introLines = [
        'Teleported from the local VS Code runtime after a HIGH-risk confirmation.',
        `Repo: ${repoName}`,
        `Branch: ${branchName}`,
      ];
      if (remoteUrl) {
        introLines.push(`Remote: ${remoteUrl}`);
      }
      introLines.push('Note: uncommitted local changes may not be present remotely.');
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

      // STEP 4: Start new conversation and send the summary
      deps.sentTestEvents.length = 0;
      deps.printedExitFor.clear();
      await deps.getConversation()?.startNewConversation();
      await deps.getConversation()?.sendUserMessage(firstRemoteMessage);

      // STEP 5: Notify success
      deps.getOutputChannel()?.appendLine(`[hal.teleport] Teleport successful to ${serverDisplayName}`);
      await postToWebview({
        type: 'halTeleportSuccess',
        serverUrl: targetServerUrl,
        serverLabel: targetServerLabel,
      });
    } catch (err) {
      if (activeTeleport?.didCancel || activeTeleport?.abort.signal.aborted || isAbortError(err)) {
        // Cancellation is UX-only: we return to the confirmation UI and stop HAL waiting/music.
        // We intentionally avoid trying to revert settings or unwind any in-flight connection logic.
        deps.getOutputChannel()?.appendLine('[hal.teleport] Teleport canceled by user');
        void postToWebview({ type: 'halTeleportCanceled' });
        return;
      }

      const reason = formatTeleportError(deps.renderError(err));
      deps.getOutputChannel()?.appendLine(`[hal.teleport] Teleport failed: ${reason}`);

      // If connection was never established, we haven't touched the local conversation
      // The local agent is still active and the pending action is still pending
      if (!connectionEstablished) {
        deps.getOutputChannel()?.appendLine('[hal.teleport] Connection failed - local conversation unchanged');
      }

      const posted = await postToWebview({ type: 'halTeleportFailed', error: reason, serverUrl: targetServerUrl });
      if (!posted) {
        void vscode.window.showErrorMessage(`Teleport failed: ${reason}`);
      }
    } finally {
      activeTeleport = null;
    }
  });

  return [
    cancelTeleportToRemoteRuntime,
    teleportToRemoteRuntime,
  ];
}
