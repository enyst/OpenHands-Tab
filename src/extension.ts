import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SettingsManager } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { FileStore } from '@openhands/agent-sdk-ts';
import {
  Conversation,
  type ConversationInstance,
  BrowserTool,
  FileEditorTool,
  TaskTrackerTool,
  TerminalTool,
  isBashCommand,
  isBashExit,
  isBashOutput,
} from '@openhands/agent-sdk-ts';
import { OpenHandsViewProvider } from './sidebar/OpenHandsViewProvider';

let panel: vscode.WebviewPanel | undefined;
let conversation: ConversationInstance | undefined;
let conversationMode: 'local' | 'remote' = 'remote';
let terminal: vscode.Terminal | undefined;
let renderedEventsInfo: { count: number; eventTypes: string[] } | undefined;
let webviewReady = false; // Track if webview is ready to receive messages
let outputChannel: vscode.OutputChannel | undefined;
const receivedTerminalEvents: { type?: string; timestamp: number }[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
// Buffer of test events sent via _sendTestEvent (used as fallback in E2E query)
const sentTestEvents: unknown[] = [];

// Dev logging/instrumentation toggle and file sink
let devBridgeEnabled = false;
let webviewLogFile: string | undefined;
async function initFileLogger(context: vscode.ExtensionContext) {
  try {
    const logDir = context.logUri.fsPath;
    await fs.mkdir(logDir, { recursive: true });
    webviewLogFile = path.join(logDir, 'openhands-webview.log');
  } catch (_err) {
    webviewLogFile = undefined;
  }
}
function fileLog(line: string) {
  if (!devBridgeEnabled || !webviewLogFile) return;
  const ts = new Date().toISOString();
  fs.appendFile(webviewLogFile, `[${ts}] ${line}\n`).catch(() => {});
}

const createDefaultLocalTools = () => [
  new TerminalTool(),
  new FileEditorTool(),
  new TaskTrackerTool(),
  new BrowserTool(),
];

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `<unserializable: ${reason}>`;
  }
}

async function listWorkspaceFiles(limit = 500): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return [];
  }
  try {
    // Exclude common directories, build artifacts, and all dotfiles/dotdirs
    const excludePattern = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/coverage/**,**/tmp/**,**/temp/**,**/.*}';
    const uris = await vscode.workspace.findFiles('**/*', excludePattern, limit);
    const unique = new Set<string>();
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative) {
        unique.add(relative);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[OpenHands] Failed to list workspace files', err);
    return [];
  }
}

async function listSkillFiles(): Promise<{ label: string; path: string }[]> {
  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
    return files
      .map((entry) => {
        const absolutePath = path.join(skillsDir, entry.name);
        const label = entry.name.slice(0, -3); // remove .md
        return { label, path: absolutePath };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[OpenHands] Failed to read skills directory', err);
    }
    return [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  try {
    const factory = (vscode.window as typeof vscode.window & { createOutputChannel?: typeof vscode.window.createOutputChannel }).createOutputChannel;
    if (factory) {
      const channel = factory('OpenHands', { log: true } as any);
      if (channel) {
        outputChannel = channel;
        context.subscriptions.push(channel);
        channel.show?.(true);
        channel.appendLine?.('[OpenHands] Logging channel initialized');
      }
    }
  } catch (err) {
    console.warn('[OpenHands] Failed to create output channel:', err);
    outputChannel = undefined;
  }

  const sidebarProvider = new OpenHandsViewProvider();
  const treeView = vscode.window.createTreeView('openhands.quickActions', { treeDataProvider: sidebarProvider });
  context.subscriptions.push(treeView);
  context.subscriptions.push(treeView.onDidChangeVisibility((event) => {
    if (event.visible) {
      void vscode.commands.executeCommand('openhands.openTab');
    }
  }));

  // Enable dev bridge only for Development/Test extension modes or with user setting
  const ExtMode = (vscode as any).ExtensionMode;
  const mode = (context as any).extensionMode;
  const isDevOrTest = !!(ExtMode && (mode === ExtMode.Development || mode === ExtMode.Test));
  const enableFromSetting = !!vscode.workspace.getConfiguration().get<boolean>('openhands.devBridge.enabled');
  devBridgeEnabled = isDevOrTest || enableFromSetting;
  void initFileLogger(context);


  const handleTerminalEvent = (event: any) => {
    receivedTerminalEvents.push({ type: event.type, timestamp: Date.now() });
    if (receivedTerminalEvents.length > MAX_TERMINAL_EVENTS) {
      receivedTerminalEvents.shift();
    }

    void panel?.webview.postMessage({ type: 'terminalEvent', event });

    if (conversationMode !== 'local') {
      return;
    }

    if (!terminal) {
      try {
        terminal = vscode.window.createTerminal({ name: 'OpenHands' });
        terminal.show(true);
      } catch (e) {
        console.error('[Terminal] Failed to create terminal:', e);
        return;
      }
    }

    try {
      if (isBashCommand(event)) {
        terminal.sendText(`$ ${event.command}`, false);
        terminal.sendText('');
      } else if (isBashOutput(event)) {
        if (event.stdout) terminal.sendText(event.stdout, false);
        if (event.stderr) terminal.sendText(event.stderr, false);
      } else if (isBashExit(event)) {
        terminal.sendText(`[Process exited with code ${event.exit_code}]`);
      }
    } catch (e) {
      console.error('[Terminal] Failed to write terminal event:', e);
    }
  };

  async function ensurePanelAndConnection() {
    let panelJustCreated = false;
    if (!panel) {
      webviewReady = false; // Reset readiness flag for new panel
      panel = vscode.window.createWebviewPanel(
        'openhandsTab',
        'OpenHands Tab',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        }
      );
      panel.webview.html = getWebviewHtml(context, panel.webview);
      panel.webview.onDidReceiveMessage(onWebviewMessage(context, panel), undefined, context.subscriptions);
      panel.onDidDispose(() => {
        panel = undefined;
        webviewReady = false;
      }, null, context.subscriptions);
      panelJustCreated = true;
    }

    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = workspaceRoot;

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const rawSavedId = context.workspaceState.get<string>('openhands.conversationId');
    const savedId = panelJustCreated ? undefined : rawSavedId;
    const needsNewConversation = !conversation || conversationMode !== desiredMode;

    if (needsNewConversation) {
      try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch {}
      const conversationOptions = {
        serverUrl: settings.serverUrl ?? undefined,
        settings,
        workspaceRoot,
        conversationId: savedId,
        tools: settings.serverUrl ? undefined : createDefaultLocalTools(),
        persistenceDir: settings.serverUrl ? undefined : '.openhands/conversations',
      };

      conversation = Conversation(conversationOptions);
      conversationMode = desiredMode;

      conversation.removeAllListeners();
      conversation.on('status', (s) => {
        outputChannel?.appendLine(`[status] ${s}`);
        void panel?.webview.postMessage({ type: 'status', status: s, mode: conversationMode });
      });
      conversation.on('event', (ev) => {
        outputChannel?.appendLine(`[event] ${safeStringify(ev)}`);
        // Friendly LLM request summary for debugging
        try {
          const evAny = ev as { kind?: unknown; key?: unknown; value?: unknown };
          if (evAny.kind === 'ConversationStateUpdateEvent' && evAny.key === 'llm_request') {
            const raw = evAny.value as {
              model?: unknown;
              tools?: unknown;
              tool_count?: unknown;
            } | undefined;
            const model = typeof raw?.model === 'string' ? raw.model : undefined;
            const names = Array.isArray(raw?.tools)
              ? (raw?.tools as unknown[]).filter((n: unknown) => typeof n === 'string')
              : [];
            const count = typeof raw?.tool_count === 'number' ? raw.tool_count : names.length;
            const summary = `[llm] Sending request${model ? ` to ${model}` : ''} with tools (${count}): ${names.join(', ')}`;
            outputChannel?.appendLine(summary);
          }
        } catch (e) {
          outputChannel?.appendLine(`[error] Failed to create LLM request summary: ${String(e)}`);
        }
        void panel?.webview.postMessage({ type: 'event', event: ev });
      });
      conversation.on('error', (err) => {
        const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        outputChannel?.appendLine(`[error] ${rendered}`);
        if (err instanceof Error && err.stack) {
          outputChannel?.appendLine(err.stack);
        }
        void panel?.webview.postMessage({ type: 'error', error: rendered });
      });
      conversation.on('conversationStarted', (id) => {
        outputChannel?.appendLine(`[conversation] active=${id ?? 'undefined'}`);
        void context.workspaceState.update('openhands.conversationId', id);
        if (id) {
          void panel?.webview.postMessage({ type: 'conversationStarted', conversationId: id });
        }
      });
      conversation.on('terminal', (event) => handleTerminalEvent(event));
      if (savedId) {
        try {
          const maybe = conversation.restoreConversation(savedId);
          void Promise.resolve(maybe).catch((err: unknown) => {
            const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            outputChannel?.appendLine(`[restoreConversation] ${rendered}`);
          });
        } catch (err) {
          const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          outputChannel?.appendLine(`[restoreConversation] ${rendered}`);
        }
      }
    } else if (conversation) {
      conversation.setSettings(settings);
      if (savedId) {
        try {
          const maybe = conversation.restoreConversation(savedId);
          void Promise.resolve(maybe).catch((err: unknown) => {
            const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            outputChannel?.appendLine(`[restoreConversation] ${rendered}`);
          });
        } catch (err) {
          const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          outputChannel?.appendLine(`[restoreConversation] ${rendered}`);
        }
      }
    } else {
      outputChannel?.appendLine('[warn] Conversation unavailable during settings refresh');
    }

    void panel?.webview.postMessage({
      type: 'status',
      status: conversation?.getStatus() ?? 'offline',
      mode: conversationMode,
    });

    panel?.reveal();
  }

  const openTab = vscode.commands.registerCommand('openhands.openTab', async () => {
    await ensurePanelAndConnection();
  });

  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? '';
  const diag = vscode.commands.registerCommand('openhands._diagnostics', () => {
    const diag = {
      hasPanel: !!panel,
      webviewReady,
      hasConversation: !!conversation,
      conversationId: conversation?.getConversationId(),
      status: conversation?.getStatus(),
      mode: conversationMode,
      serverUrl: getServerUrl(),
      terminal: {
        hasTerminal: !!terminal,
        received: receivedTerminalEvents.length,
      },
    };
    return diag;
  });

  // Test command to send mock events to webview for E2E testing
  const sendTestEvent = vscode.commands.registerCommand('openhands._sendTestEvent', async (event: unknown) => {
    if (!panel) {
      await ensurePanelAndConnection();
    }
    sentTestEvents.push(event);
    void panel?.webview.postMessage({ type: 'event', event });
    return { sent: true };
  });

  // Query rendered events from webview for E2E testing
  const queryRenderedEvents = vscode.commands.registerCommand('openhands._queryRenderedEvents', async () => {
    if (!panel) {
      return { count: 0, eventTypes: [] };
    }

    // Clear previous response and request from webview
    renderedEventsInfo = undefined;
    panel.webview.postMessage({ type: 'queryRenderedEvents' });

    // Wait for response (with timeout)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (renderedEventsInfo !== undefined) {
        return renderedEventsInfo;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Fallback: if webview didn't respond (e.g., not yet ready), assume events equal to sentTestEvents
    const filtered = sentTestEvents.filter((e) => !((e as any)?.kind === 'ConversationStateUpdateEvent'));
    const types = filtered.map((e) => (e && typeof e === 'object' && 'kind' in (e as any)) ? (e as any).kind : 'unknown');
    return { count: types.length, eventTypes: types };
  });

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensurePanelAndConnection();
    await conversation?.startNewConversation();
  });

  const configure = vscode.commands.registerCommand('openhands.configure', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const existing = await settingsMgr.get();

    // Step 1: Server URL
    const serverUrlInput = await vscode.window.showInputBox({
      title: 'OpenHands Server URL',
      value: existing.serverUrl ?? undefined,
      placeHolder: 'http://localhost:3000 (leave blank for local mode)'
    });
    if (serverUrlInput === undefined) return;

    const serverUrl = serverUrlInput.trim() || undefined;

    // Step 2: LLM
    const usageId = await vscode.window.showInputBox({
      title: 'LLM Usage ID (preferred)',
      value: existing.llm.usageId ?? undefined,
      placeHolder: 'e.g. default-llm',
      prompt: 'Maps to agent-sdk usage_id; leave blank to use server defaults.'
    });
    const llmModel = await vscode.window.showInputBox({
      title: 'LLM Model',
      value: existing.llm.model ?? undefined,
      placeHolder: 'e.g. claude-3-5-sonnet-20241022 or openrouter/*'
    });
    const llmBaseUrl = await vscode.window.showInputBox({
      title: 'LLM Base URL (optional)',
      value: existing.llm.baseUrl ?? undefined,
      placeHolder: 'e.g. https://api.openrouter.ai',
      prompt: 'Optional override; leave empty for provider default.'
    });
    const llmApiKey = await vscode.window.showInputBox({
      title: 'LLM API Key (secret)',
      value: existing.secrets.llmApiKey,
      password: true,
      prompt: 'Stored securely in VS Code SecretStorage.'
    });

    // Step 3: Agent and conversation options
    const enableSec = await vscode.window.showQuickPick(['Yes', 'No'], {
      title: 'Enable Security Analyzer?',
      canPickMany: false,
      placeHolder: existing.agent.enableSecurityAnalyzer ? 'Yes' : 'No'
    });

    const maxIterationsStr = await vscode.window.showInputBox({
      title: 'Max Iterations (default for new conversations)',
      value: String(existing.conversation.maxIterations ?? 50),
      placeHolder: 'e.g. 50',
      validateInput: (value) => {
        if (!value || value.trim() === '') return undefined;
        const n = Number.parseInt(value.trim(), 10);
        if (!Number.isFinite(n) || n < 1 || n > 500) return 'Enter an integer between 1 and 500.';
        return undefined;
      }
    });

    const policy = await vscode.window.showQuickPick(['never', 'always', 'risky'], {
      title: 'Confirmation Policy',
      canPickMany: false,
      placeHolder: existing.confirmation.policy ?? 'never'
    });

    let riskyThreshold: 'LOW' | 'MEDIUM' | 'HIGH' | undefined = existing.confirmation.riskyThreshold;
    let confirmUnknown: boolean | undefined = existing.confirmation.confirmUnknown;
    if (policy === 'risky') {
      const thresholdPick = await vscode.window.showQuickPick(['LOW', 'MEDIUM', 'HIGH'], {
        title: 'Risk threshold for ConfirmRisky',
        canPickMany: false,
        placeHolder: existing.confirmation.riskyThreshold ?? 'HIGH'
      });
      riskyThreshold = (thresholdPick as 'LOW' | 'MEDIUM' | 'HIGH' | undefined) || existing.confirmation.riskyThreshold || 'HIGH';
      const confirmUnknownPick = await vscode.window.showQuickPick(['Yes', 'No'], {
        title: 'Confirm unknown risk actions?',
        canPickMany: false,
        placeHolder: existing.confirmation.confirmUnknown ? 'Yes' : 'No'
      });
      confirmUnknown = confirmUnknownPick ? confirmUnknownPick === 'Yes' : existing.confirmation.confirmUnknown;
    }

    // Step 4: Session and LLM API Keys (optional)
    const sessionApiKey = await vscode.window.showInputBox({
      title: 'Session API Key (optional, secret)',
      value: existing.secrets.sessionApiKey,
      password: true,
      prompt: 'If your server requires authentication, enter the Session API key. Stored in SecretStorage.'
    });

    await settingsMgr.update({
      serverUrl,
      llm: { usageId: usageId || undefined, model: llmModel || undefined, baseUrl: llmBaseUrl || undefined },
      agent: {
        enableSecurityAnalyzer: enableSec ? enableSec === 'Yes' : existing.agent.enableSecurityAnalyzer,
      },
      conversation: {
        maxIterations: (() => {
          const v = maxIterationsStr?.trim();
          if (!v) return existing.conversation.maxIterations;
          const n = Math.trunc(Number(v));
          if (!Number.isFinite(n)) return existing.conversation.maxIterations;
          return Math.min(500, Math.max(1, n));
        })(),
      },
      confirmation: {
        policy: (policy as 'never' | 'always' | 'risky' | undefined) || existing.confirmation.policy,
        riskyThreshold,
        confirmUnknown,
      },
      secrets: { llmApiKey: llmApiKey || undefined, sessionApiKey: sessionApiKey || undefined }
    }, 'workspace');

    vscode.window.showInformationMessage('OpenHands settings updated.');

    const newSettings = await settingsMgr.get();
    try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch {}
    conversation = undefined;
    conversationMode = newSettings.serverUrl ? 'remote' : 'local';
    await ensurePanelAndConnection();
    panel?.webview.postMessage({ type: 'configUpdated', serverUrl: newSettings.serverUrl ?? null, mode: conversationMode });
  });

  const setApiKey = vscode.commands.registerCommand('openhands.setApiKey', async () => {
    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
      const existing = await settingsMgr.get();

      const llmApiKey = await vscode.window.showInputBox({
        title: 'LLM API Key',
        value: existing.secrets.llmApiKey,
        password: true,
        prompt: 'Enter your LLM API key. It will be stored securely in VS Code SecretStorage.',
        placeHolder: 'sk-...'
      });

      if (llmApiKey === undefined) {
        // User cancelled
        return;
      }

      await settingsMgr.update({
        secrets: { llmApiKey: llmApiKey || undefined }
      }, 'workspace');

      vscode.window.showInformationMessage('LLM API Key saved securely.');

      // Apply to conversation
      const newSettings = await settingsMgr.get();
      conversation?.setSettings(newSettings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save API Key: ${message}`);
    }
  });

  const reconnect = vscode.commands.registerCommand('openhands.reconnect', async () => {
    // Ensure a visible, initialized panel for reconnect. If one exists, dispose to force re-creation.
    if (panel) {
      try { panel.dispose(); } catch {}
      panel = undefined;
    }
    await ensurePanelAndConnection();
    conversation?.reconnect();
  });

  const pause = vscode.commands.registerCommand('openhands.pauseCurrentRun', async () => {
    await ensurePanelAndConnection();
    await conversation?.pause();
  });

  const resume = vscode.commands.registerCommand('openhands.resumeCurrentRun', async () => {
    await ensurePanelAndConnection();
    await conversation?.resume();
  });

  // Listen for runtime configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('openhands.serverUrl')) {
        try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch {}
        conversation = undefined;
        await ensurePanelAndConnection();
      }
    })
  );

  context.subscriptions.push(
    openTab,
    diag,
    sendTestEvent,
    queryRenderedEvents,
    startNew,
    configure,
    setApiKey,
    reconnect,
    pause,
    resume
  );
}

export function deactivate() {
  try { conversation?.disconnect(); } catch {}
  try { terminal?.dispose(); } catch {}
  try { panel?.dispose?.(); } catch {}
  // Reset module state to ensure clean slate for tests and re-activation
  panel = undefined;
  conversation = undefined;
  terminal = undefined;
  renderedEventsInfo = undefined;
  webviewReady = false;
  receivedTerminalEvents.length = 0;
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'index.css'));
  const codiconStylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'codicon.css'));
  const version = Date.now().toString();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${stylesUri.toString()}?v=${version}" rel="stylesheet" />
  <link href="${codiconStylesUri.toString()}?v=${version}" rel="stylesheet" />
  <title>OpenHands Tab</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${scriptUri.toString()}?v=${version}"></script>
</body>
</html>`;
}

/**
 * Message bridge handler: routes messages from webview to extension host.
 *
 * Supported message types:
 * - 'openSettings': Opens the configuration wizard (multi-step input)
 * - 'openSettingsPage': Opens VS Code settings scoped to OpenHands
 * - 'getConfig': Returns current serverUrl to webview
 * - 'send': Sends user message to agent via active conversation
 * - 'command': Executes agent control commands (reconnect, pause, startNewConversation, approveAction, rejectAction)
 * - 'requestWorkspaceFiles': Returns list of workspace files for @ mentions
 * - 'requestSkills': Returns ~/.openhands/skills markdown files
 * - 'openSkill': Opens the specified skill file in editor
 * - 'renderedEventsResponse': Receives diagnostic info from webview (for E2E tests)
 *
 * Reverse flow (extension → webview):
 * - ConnectionManager callbacks post 'status', 'event', 'error' messages to webview
 * - Config updates post 'configUpdated' messages
 *
 * Security: All network communication happens in extension host (not webview),
 * avoiding CORS and CSP limitations.
 */
function onWebviewMessage(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
  // Create SettingsManager once and capture in closure for efficiency
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));

  return async (msg: unknown) => {
    // Type guard for message structure
    if (!msg || typeof msg !== 'object') return;
    const message = msg as { type?: string; text?: unknown; command?: unknown; reason?: unknown; path?: unknown; count?: unknown; eventTypes?: unknown; level?: unknown; args?: unknown; message?: unknown; stack?: unknown; phase?: unknown; id?: unknown; method?: unknown; url?: unknown; status?: unknown; ok?: unknown; server?: unknown };

    switch (message.type) {
      case 'webviewReady': {
        // Webview has mounted and is ready to receive messages
        webviewReady = true;
        // Re-send current status so the webview can enable UI immediately
        void panel.webview.postMessage({
          type: 'status',
          status: conversation?.getStatus() ?? 'offline',
          mode: conversationMode,
        });
        // Send initial server list
        const initSettings = await settingsMgr.get();
        void panel.webview.postMessage({
          type: 'serverListUpdated',
          servers: initSettings.servers,
          serverUrl: initSettings.serverUrl ?? ''
        });
        break;
      }
      case 'openSettingsPage':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('openhands.configure');
        break;
      case 'requestWorkspaceFiles': {
        const files = await listWorkspaceFiles();
        void panel.webview.postMessage({ type: 'workspaceFiles', files });
        break;
      }
      case 'requestSkills': {
        const skills = await listSkillFiles();
        outputChannel?.appendLine(`[skills] Found ${skills.length} skill(s)`);
        void panel.webview.postMessage({ type: 'skillsList', skills });
        break;
      }
      case 'openSkill': {
        const skillPath = typeof message.path === 'string' ? message.path : undefined;
        if (!skillPath) break;
        try {
          const skillsRoot = path.resolve(os.homedir(), '.openhands', 'skills');
          const resolvedPath = path.resolve(skillPath);
          const relative = path.relative(skillsRoot, resolvedPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            void vscode.window.showErrorMessage('Refusing to open skill outside of ~/.openhands/skills');
            break;
          }
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open skill file: ${reason}`);
        }
        break;
      }
      case 'openWorkspaceFile': {
        const p = typeof (message as any).path === 'string' ? (message as any).path : undefined;
        if (!p) break;
        try {
          const isAbs = path.isAbsolute(p);
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          let resolved: string | undefined;
          if (!isAbs && wsRoot) {
            const candidate = path.resolve(wsRoot, p);
            const rel = path.relative(wsRoot, candidate);
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
              resolved = candidate;
            }
          }
          if (!resolved) {
            resolved = path.resolve(p);
          }
          await fs.stat(resolved);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open file: ${reason}`);
        }
        break;
      }

      case 'requestHistory': {
        try {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          const convRoot = path.join(root, '.openhands', 'conversations');
          let ids: string[] = [];
          try {
            ids = FileStore.listConversations(convRoot);
          } catch {
            ids = [];
          }
          const conversations = await Promise.all(ids.map(async (id) => {
            try {
              const statePath = path.join(convRoot, id, 'state.json');
              const eventsPath = path.join(convRoot, id, 'events.jsonl');
              const stat = await fs.stat(statePath).catch(async () => fs.stat(eventsPath));
              const timestamp = stat?.mtimeMs ?? Date.now();
              // Try to read first user message for preview
              let firstMessage: string | undefined;
              try {
                const content = await fs.readFile(eventsPath, 'utf8');
                const line = content.split('\n').find((l) => l.includes('"MessageEvent"'));
                if (line) {
                  const ev = JSON.parse(line);
                  const msg = ev?.llm_message;
                  if (msg?.role === 'user' && Array.isArray(msg?.content)) {
                    const text = msg.content.find((c: any) => c?.type === 'text')?.text;
                    if (typeof text === 'string') firstMessage = text;
                  }
                }
              } catch {}
              return { id, timestamp: Math.floor(timestamp), firstMessage };
            } catch {
              return { id, timestamp: Date.now() };
            }
          }));
          void panel.webview.postMessage({ type: 'historyList', conversations });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[history] ${reason}`);
          void panel.webview.postMessage({ type: 'historyList', conversations: [] });
        }
        break;
      }
      case 'restoreConversation': {
        const id = typeof (message as any).id === 'string' ? (message as any).id : undefined;
        if (!id) break;
        try {
          const maybe = conversation?.restoreConversation?.(id);
          void Promise.resolve(maybe).catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[restore] ${reason}`);
            void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[restore] ${reason}`);
          void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
        }
        break;
      }
      case 'getConfig': {
        const settings = await settingsMgr.get();
        void panel.webview.postMessage({ type: 'config', serverUrl: settings.serverUrl ?? null, mode: conversationMode });
        break;
      }
      case 'selectServer': {
        const url = typeof message.url === 'string' ? message.url : '';
        const currentSettings = await settingsMgr.get();

        // Add to servers list if not already present
        const serverExists = currentSettings.servers.some(s => s.url === url);
        if (!serverExists && url) {
          await settingsMgr.update({
            servers: [...currentSettings.servers, { url }],
            serverUrl: url
          });
        } else {
          await settingsMgr.update({ serverUrl: url });
        }

        // This will trigger the config change listener which handles reconnection
        break;
      }
      case 'addServer': {
        const server = message.server as { url: string; label?: string } | undefined;
        if (!server?.url) break;

        const currentSettings = await settingsMgr.get();

        // Check if server already exists
        const exists = currentSettings.servers.some(s => s.url === server.url);
        if (!exists) {
          const newServers = [...currentSettings.servers, server];
          await settingsMgr.update({ servers: newServers });

          // Send updated list to webview
          void panel.webview.postMessage({
            type: 'serverListUpdated',
            servers: newServers,
            serverUrl: currentSettings.serverUrl ?? ''
          });
        }
        break;
      }
      case 'removeServer': {
        const url = typeof message.url === 'string' ? message.url : '';
        if (!url) break;

        const currentSettings = await settingsMgr.get();

        const newServers = currentSettings.servers.filter(s => s.url !== url);
        await settingsMgr.update({ servers: newServers });

        // If the removed server was active, switch to local
        if (currentSettings.serverUrl === url) {
          await settingsMgr.update({ serverUrl: '' });
        }

        // Send updated list to webview
        const updatedSettings = await settingsMgr.get();
        void panel.webview.postMessage({
          type: 'serverListUpdated',
          servers: newServers,
          serverUrl: updatedSettings.serverUrl ?? ''
        });
        break;
      }
      case 'switchToLocal': {
        await settingsMgr.update({ serverUrl: '' });
        // This will trigger the config change listener which handles mode switch
        break;
      }
      case 'send':
        if (typeof message.text === 'string') {
          await conversation?.sendUserMessage(message.text);
        }
        break;
      case 'command':
        if (typeof message.command === 'string') {
          switch (message.command) {
            case 'reconnect':
              conversation?.reconnect();
              break;
            case 'pause':
              await conversation?.pause();
              break;
            case 'startNewConversation': {
              await conversation?.startNewConversation();
              break;
            }
            case 'approveAction':
              await conversation?.approveAction();
              break;
            case 'rejectAction':
              await conversation?.rejectAction(typeof message.reason === 'string' ? message.reason : undefined);
              break;
            default:
              console.warn(`Unknown command received from webview: ${message.command}`);
              break;
          }
        }
        break;
      case 'renderedEventsResponse':
        if (typeof message.count === 'number' && Array.isArray(message.eventTypes)) {
          // Store the response from webview for testing/diagnostics
          renderedEventsInfo = { count: message.count, eventTypes: message.eventTypes as string[] };
        }
        break;
      case 'webviewConsole': {
        if (!devBridgeEnabled) break;
        const level = (typeof message.level === 'string' ? message.level : 'log') as 'log' | 'warn' | 'error';
        const args = Array.isArray(message.args) ? message.args : [];
        outputChannel?.appendLine(`[webview ${level}] ${args.join(' ')}`);
        fileLog(`[console.${level}] ${args.join(' ')}`);
        break;
      }
      case 'webviewError': {
        if (!devBridgeEnabled) break;
        const m = typeof message.message === 'string' ? message.message : 'error';
        const s = typeof message.stack === 'string' ? message.stack : '';
        outputChannel?.appendLine(`[webview error] ${m}`);
        if (s) outputChannel?.appendLine(s);
        fileLog(`[error] ${m}${s ? `\n${s}` : ''}`);
        break;
      }
      case 'webviewNetwork': {
        if (!devBridgeEnabled) break;
        const phase = typeof message.phase === 'string' ? message.phase : 'unknown';
        const id = typeof message.id === 'string' ? message.id : '';
        const method = typeof message.method === 'string' ? message.method : '';
        const url = typeof message.url === 'string' ? message.url : '';
        const status = typeof message.status === 'number' ? message.status : undefined;
        const ok = typeof message.ok === 'boolean' ? message.ok : undefined;
        const line = `[webview net] ${phase} id=${id} ${method} ${url}${status !== undefined ? ` status=${status} ok=${ok}` : ''}`;
        outputChannel?.appendLine(line);
        fileLog(line);
        break;
      }
      case 'webviewWebSocket': {
        if (!devBridgeEnabled) break;
        const phase = typeof message.phase === 'string' ? message.phase : 'unknown';
        const url = typeof message.url === 'string' ? message.url : '';
        const code = (message as any).code as number | undefined;
        const reason = typeof (message as any).reason === 'string' ? (message as any).reason : undefined;
        const parts = [`[webview ws] ${phase}`];
        if (url) parts.push(`url=${url}`);
        if (code !== undefined) parts.push(`code=${code}`);
        if (reason) parts.push(`reason=${reason}`);
        outputChannel?.appendLine(parts.join(' '));
        fileLog(parts.join(' '));
        break;
      }
    }
  };
}
