import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConnectionManager } from './connection/ConnectionManager';
import { SettingsManager } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';
import { BashEventsClient } from './terminal/BashEventsClient';
import { isBashCommand, isBashOutput, isBashExit } from './types/agent-sdk';
import { OpenHandsViewProvider } from './sidebar/OpenHandsViewProvider';

let panel: vscode.WebviewPanel | undefined;
let connection: ConnectionManager | undefined;
let bashEventsClient: BashEventsClient | undefined;
let terminal: vscode.Terminal | undefined;
let renderedEventsInfo: { count: number; eventTypes: string[] } | undefined;
let webviewReady = false; // Track if webview is ready to receive messages
let outputChannel: vscode.OutputChannel | undefined;
const receivedBashEvents: any[] = []; // Track bash events for testing
const MAX_BASH_EVENTS = 1000; // Ring buffer size limit to prevent memory growth

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
  outputChannel = vscode.window.createOutputChannel('OpenHands', { log: true });
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[OpenHands] Logging channel initialized');
  outputChannel.show(true);

  const sidebarProvider = new OpenHandsViewProvider();
  const treeView = vscode.window.createTreeView('openhands.quickActions', { treeDataProvider: sidebarProvider });
  context.subscriptions.push(treeView);
  context.subscriptions.push(treeView.onDidChangeVisibility((event) => {
    if (event.visible) {
      void vscode.commands.executeCommand('openhands.openTab');
    }
  }));

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

    // Fetch settings once and reuse for both connection and bash events client
    const settings = await new SettingsManager(new VscodeSettingsAdapter(context)).get();
    const serverUrl = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';

    if (!connection) {
      // Expose workspace root path for ConnectionManager to consume (without importing vscode).
      (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      connection = new ConnectionManager(serverUrl, {
        onStatus: (s) => {
          outputChannel?.appendLine(`[status] ${s}`);
          void panel?.webview.postMessage({ type: 'status', status: s });
        },
        onEvent: (ev) => {
          outputChannel?.appendLine(`[event] ${safeStringify(ev)}`);
          void panel?.webview.postMessage({ type: 'event', event: ev });
        },
        onError: (err) => {
          const rendered = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          outputChannel?.appendLine(`[error] ${rendered}`);
          if (err instanceof Error && err.stack) {
            outputChannel?.appendLine(err.stack);
          }
          void panel?.webview.postMessage({ type: 'error', error: rendered });
        },
        onConversationId: (id) => {
          outputChannel?.appendLine(`[conversation] active=${id ?? 'undefined'}`);
          void context.workspaceState.update('openhands.conversationId', id);
          if (id) {
            void panel?.webview.postMessage({ type: 'conversationStarted', conversationId: id });
          }
        },
      });
      const savedId = context.workspaceState.get<string>('openhands.conversationId');
      connection.setSettings(settings);
      if (savedId) connection.restoreConversation(savedId);
    }

    // Initialize bash events client if enabled
    const bashEventsEnabled = vscode.workspace.getConfiguration().get<boolean>('openhands.bashEvents.enabled', false);
    if (bashEventsEnabled && !bashEventsClient) {
      const sessionApiKey = settings.secrets.sessionApiKey;

      bashEventsClient = new BashEventsClient(
        serverUrl,
        {
          onEvent: (event) => {
            // Track received bash events for testing (with ring buffer to prevent memory growth)
            receivedBashEvents.push({ type: event.type, timestamp: Date.now() });
            if (receivedBashEvents.length > MAX_BASH_EVENTS) {
              receivedBashEvents.shift();
            }

            // Create terminal on first event
            if (!terminal) {
              try {
                terminal = vscode.window.createTerminal({ name: 'OpenHands' });
                terminal.show(true);
              } catch (e) {
                console.error('[BashEvents] Failed to create terminal:', e);
                // Terminal creation may fail in headless/test environments - continue without terminal
              }
            }

            // Write events to terminal (skip if terminal creation failed)
            if (terminal) {
              try {
                if (isBashCommand(event)) {
                  terminal.sendText(`$ ${event.command}`, false);
                  terminal.sendText(''); // newline
                } else if (isBashOutput(event)) {
                  if (event.stdout) terminal.sendText(event.stdout, false);
                  if (event.stderr) terminal.sendText(event.stderr, false);
                } else if (isBashExit(event)) {
                  terminal.sendText(`[Process exited with code ${event.exit_code}]`);
                }
              } catch (e) {
                console.error('[BashEvents] Failed to write to terminal:', e);
              }
            }
          },
          onError: (err) => {
            vscode.window.showErrorMessage(`Bash Events: ${String(err)}`);
          },
          onStatus: (status) => {
            // Optional: could show status in status bar
            console.log(`[BashEventsClient] Status: ${status}`);
          },
        },
        sessionApiKey
      );

      bashEventsClient.connect();
    } else if (!bashEventsEnabled && bashEventsClient) {
      // Disable bash events if setting changed
      bashEventsClient.disconnect();
      bashEventsClient = undefined;
      terminal?.dispose();
      terminal = undefined;
    }

    panel?.reveal();
  }

  const openTab = vscode.commands.registerCommand('openhands.openTab', async () => {
    await ensurePanelAndConnection();
  });

  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
  const diag = vscode.commands.registerCommand('openhands._diagnostics', () => {
    const diag = {
      hasPanel: !!panel,
      webviewReady,
      hasConnection: !!connection,
      conversationId: connection?.getConversationId(),
      status: connection?.getStatus(),
      serverUrl: getServerUrl(),
      bashEvents: {
        enabled: vscode.workspace.getConfiguration().get<boolean>('openhands.bashEvents.enabled', false),
        hasClient: !!bashEventsClient,
        clientStatus: bashEventsClient?.getStatus(),
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

  // Inject bash event for E2E testing
  const injectBashEvent = vscode.commands.registerCommand('openhands._injectBashEvent', async (event: any) => {
    if (!bashEventsClient) {
      // Initialize bash events if not already done
      await ensurePanelAndConnection();
    }
    if (bashEventsClient) {
      bashEventsClient.injectEvent(event);
      return { injected: true };
    }
    return { injected: false, error: 'BashEventsClient not initialized' };
  });

  // Query received bash events for E2E testing
  const queryBashEvents = vscode.commands.registerCommand('openhands._queryBashEvents', () => {
    return {
      count: receivedBashEvents.length,
      eventTypes: receivedBashEvents.map((e) => e.type),
      events: receivedBashEvents,
    };
  });

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensurePanelAndConnection();
    await connection?.startNewConversation();
  });

  const configure = vscode.commands.registerCommand('openhands.configure', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const existing = await settingsMgr.get();

    // Step 1: Server URL
    const serverUrl = await vscode.window.showInputBox({
      title: 'OpenHands Server URL',
      value: existing.serverUrl,
      placeHolder: 'http://localhost:3000'
    });
    if (!serverUrl) return;

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

    // Apply to connection
    connection?.setServerUrl(serverUrl);
    const newSettings = await settingsMgr.get();
    connection?.setSettings(newSettings);
    panel?.webview.postMessage({ type: 'configUpdated', serverUrl });

    // Apply to bash events client
    if (bashEventsClient) {
      bashEventsClient.setServerUrl(serverUrl);
      bashEventsClient.setSessionApiKey(newSettings.secrets.sessionApiKey);
      bashEventsClient.reconnect();
    }
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

      // Apply to connection
      const newSettings = await settingsMgr.get();
      connection?.setSettings(newSettings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save API Key: ${message}`);
    }
  });

  const reconnect = vscode.commands.registerCommand('openhands.reconnect', async () => {
    await ensurePanelAndConnection();
    connection?.reconnect();
  });

  const pause = vscode.commands.registerCommand('openhands.pauseCurrentRun', async () => {
    await ensurePanelAndConnection();
    await connection?.pause();
  });

  const resume = vscode.commands.registerCommand('openhands.resumeCurrentRun', async () => {
    await ensurePanelAndConnection();
    await connection?.resume();
  });

  // Listen for runtime configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      // Handle bash events enabled/disabled toggle
      if (e.affectsConfiguration('openhands.bashEvents.enabled')) {
        const enabled = vscode.workspace.getConfiguration().get<boolean>('openhands.bashEvents.enabled', false);

        if (enabled && !bashEventsClient) {
          // Enable bash events - initialize client
          await ensurePanelAndConnection();
        } else if (!enabled && bashEventsClient) {
          // Disable bash events - cleanup
          bashEventsClient.disconnect();
          bashEventsClient = undefined;
          terminal?.dispose();
          terminal = undefined;
        }
      }

      // Handle server URL changes
      if (e.affectsConfiguration('openhands.serverUrl')) {
        const serverUrl = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
        connection?.setServerUrl(serverUrl);
        bashEventsClient?.setServerUrl(serverUrl);
        bashEventsClient?.reconnect();
      }
    })
  );

  context.subscriptions.push(openTab, diag, sendTestEvent, queryRenderedEvents, injectBashEvent, queryBashEvents, startNew, configure, setApiKey, reconnect, pause, resume);
}

export function deactivate() {
  connection?.disconnect();
  bashEventsClient?.disconnect();
  terminal?.dispose();
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
 * - 'send': Sends user message to agent via ConnectionManager
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
        const serverUrl = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
        void panel.webview.postMessage({ type: 'config', serverUrl });
        break;
      }
      case 'send':
        if (typeof message.text === 'string') {
          await connection?.sendUserMessage(message.text);
        }
        break;
      case 'command':
        if (typeof message.command === 'string') {
          switch (message.command) {
            case 'reconnect':
              connection?.reconnect();
              break;
            case 'pause':
              await connection?.pause();
              break;
            case 'startNewConversation': {
              await connection?.startNewConversation();
              break;
            }
            case 'approveAction':
              await connection?.approveAction();
              break;
            case 'rejectAction':
              await connection?.rejectAction(typeof message.reason === 'string' ? message.reason : undefined);
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
