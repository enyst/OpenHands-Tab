import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SettingsManager } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
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
const receivedTerminalEvents: any[] = []; // Track terminal events for testing
const MAX_TERMINAL_EVENTS = 1000; // Ring buffer size limit to prevent memory growth
const injectedBashEvents: any[] = [];
let bashEventsEnabled = false;
let bashEventsClientInitialized = false;
let bashEventsClientStatus: 'online' | 'offline' = 'offline';

const createDefaultLocalTools = () => [
  new TerminalTool(),
  new FileEditorTool(),
  new TaskTrackerTool(),
  new BrowserTool(),
];

function refreshBashEventsConfig() {
  bashEventsEnabled = !!vscode.workspace.getConfiguration().get<boolean>('openhands.bashEvents.enabled');
  if (!bashEventsEnabled) {
    bashEventsClientInitialized = false;
    bashEventsClientStatus = 'offline';
  }
}

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
    const uris = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.venv/**}', limit);
    const unique = new Set<string>();
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative) unique.add(relative);
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
  refreshBashEventsConfig();
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
    }

    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = workspaceRoot;

    refreshBashEventsConfig();
    if (bashEventsEnabled) {
      bashEventsClientInitialized = true;
      bashEventsClientStatus = 'offline';
    }

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const savedId = context.workspaceState.get<string>('openhands.conversationId');
    const needsNewConversation = !conversation || conversationMode !== desiredMode;

    if (needsNewConversation) {
      try { conversation?.removeAllListeners(); conversation?.disconnect(); } catch {}
      const conversationOptions = {
        serverUrl: settings.serverUrl ?? undefined,
        settings,
        workspaceRoot,
        conversationId: savedId,
        tools: settings.serverUrl ? undefined : createDefaultLocalTools(),
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
      bashEvents: {
        enabled: bashEventsEnabled,
        hasClient: bashEventsClientInitialized,
        clientStatus: bashEventsClientStatus,
        hasTerminal: !!terminal,
      },
    };
    return diag;
  });

  // Test command to send mock events to webview for E2E testing
  const sendTestEvent = vscode.commands.registerCommand('openhands._sendTestEvent', async (event: unknown) => {
    if (!panel) {
      await ensurePanelAndConnection();
    }
    void panel?.webview.postMessage({ type: 'event', event });
    return { sent: true };
  });

  const injectBashEvent = vscode.commands.registerCommand('openhands._injectBashEvent', (event: any) => {
    refreshBashEventsConfig();
    if (!bashEventsEnabled) {
      bashEventsEnabled = true;
    }
    bashEventsClientInitialized = true;
    bashEventsClientStatus = 'offline';
    injectedBashEvents.push(event);
    if (injectedBashEvents.length > MAX_TERMINAL_EVENTS) {
      injectedBashEvents.shift();
    }
    handleTerminalEvent(event);
    return { injected: true };
  });

  const queryBashEvents = vscode.commands.registerCommand('openhands._queryBashEvents', () => {
    const eventTypes = injectedBashEvents.map((e) => (e && typeof e.type === 'string' ? e.type : 'unknown'));
    return { count: injectedBashEvents.length, eventTypes };
  });

  // Query rendered events from webview for E2E testing
  const queryRenderedEvents = vscode.commands.registerCommand('openhands._queryRenderedEvents', async () => {
    if (!panel) {
      return { count: 0, eventTypes: [] };
    }

    // Clear previous response
    renderedEventsInfo = undefined;

    // Ask webview for current state
    panel.webview.postMessage({ type: 'queryRenderedEvents' });

    // Wait for response (with timeout)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (renderedEventsInfo !== undefined) {
        return renderedEventsInfo;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    return { count: 0, eventTypes: [] }; // timeout
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
      } else if (e.affectsConfiguration('openhands.bashEvents.enabled')) {
        refreshBashEventsConfig();
        if (!bashEventsEnabled) {
          injectedBashEvents.length = 0;
          bashEventsClientInitialized = false;
          bashEventsClientStatus = 'offline';
        }
      }
    })
  );

  context.subscriptions.push(
    openTab,
    diag,
    sendTestEvent,
    injectBashEvent,
    queryBashEvents,
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
  injectedBashEvents.length = 0;
  bashEventsEnabled = false;
  bashEventsClientInitialized = false;
  bashEventsClientStatus = 'offline';
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
  return async (msg: unknown) => {
    // Type guard for message structure
    if (!msg || typeof msg !== 'object') return;
    const message = msg as { type?: string; text?: unknown; command?: unknown; reason?: unknown; path?: unknown; count?: unknown; eventTypes?: unknown };

    switch (message.type) {
      case 'webviewReady':
        // Webview has mounted and is ready to receive messages
        webviewReady = true;
        break;
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
      case 'getConfig': {
        const settings = await new SettingsManager(new VscodeSettingsAdapter(context)).get();
        void panel.webview.postMessage({ type: 'config', serverUrl: settings.serverUrl ?? null, mode: conversationMode });
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
    }
  };
}
