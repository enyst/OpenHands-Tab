import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';
import { SettingsManager } from './settings/SettingsManager';
import { VscodeSettingsAdapter } from './settings/VscodeSettingsAdapter';

let panel: vscode.WebviewPanel | undefined;
let connection: ConnectionManager | undefined;
let renderedEventsInfo: { count: number; eventTypes: string[] } | undefined;

export function activate(context: vscode.ExtensionContext) {
  async function ensurePanelAndConnection() {
    if (!panel) {
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
      panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
    }

    if (!connection) {
      const serverUrl = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
      connection = new ConnectionManager(serverUrl, {
        onStatus: (s) => panel?.webview.postMessage({ type: 'status', status: s }),
        onEvent: (ev) => panel?.webview.postMessage({ type: 'event', event: ev }),
        onError: (err) => panel?.webview.postMessage({ type: 'error', error: String(err) }),
        onConversationId: (id) => context.workspaceState.update('openhands.conversationId', id),
      });
      const settings = await new SettingsManager(new VscodeSettingsAdapter(context)).get();
      const savedId = context.workspaceState.get<string>('openhands.conversationId');
      connection.setSettings(settings);
      if (savedId) connection.restoreConversation(savedId);
    }

    panel?.reveal();
  }

  const openTab = vscode.commands.registerCommand('openhands.openTab', async () => {
    await ensurePanelAndConnection();
  });

  // Diagnostics command for E2E tests and troubleshooting
  const getServerUrl = () => vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
  const diag = vscode.commands.registerCommand('openhands._diagnostics', async () => {
    const diag = {
      hasPanel: !!panel,
      hasConnection: !!connection,
      conversationId: connection?.getConversationId(),
      status: connection?.getStatus(),
      serverUrl: getServerUrl(),
    };
    return diag;
  });

  // Test command to send mock events to webview for E2E testing
  const sendTestEvent = vscode.commands.registerCommand('openhands._sendTestEvent', async (event: any) => {
    if (!panel) {
      await ensurePanelAndConnection();
    }
    panel?.webview.postMessage({ type: 'event', event });
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
    const deadline = Date.now() + 2000;
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
        const n = parseInt(value, 10);
        if (Number.isNaN(n) || n <= 0) return 'Input must be a positive integer.';
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
      riskyThreshold = (thresholdPick as any) || existing.confirmation.riskyThreshold || 'HIGH';
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
        maxIterations: maxIterationsStr ? Number(maxIterationsStr) : existing.conversation.maxIterations,
      },
      confirmation: {
        policy: (policy as any) || existing.confirmation.policy,
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
  });

  const reconnect = vscode.commands.registerCommand('openhands.reconnect', async () => {
    await ensurePanelAndConnection();
    connection?.reconnect();
  });

  const pause = vscode.commands.registerCommand('openhands.pauseCurrentRun', async () => {
    await ensurePanelAndConnection();
    await connection?.pause();
  });

  context.subscriptions.push(openTab, diag, sendTestEvent, queryRenderedEvents, startNew, configure, reconnect, pause);
}

export function deactivate() {
  connection?.disconnect();
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'index.css'));
  const version = Date.now().toString();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${stylesUri}?v=${version}" rel="stylesheet" />
  <title>OpenHands Tab</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${scriptUri}?v=${version}"></script>
</body>
</html>`;
}

function onWebviewMessage(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
  return async (msg: any) => {
    if (msg?.type === 'openSettings') {
      await vscode.commands.executeCommand('openhands.configure');
    }
    if (msg?.type === 'getConfig') {
      const serverUrl = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
      panel.webview.postMessage({ type: 'config', serverUrl });
    }
    if (msg?.type === 'send' && typeof msg.text === 'string') {
      await connection?.sendUserMessage(msg.text);
    }
    if (msg?.type === 'command') {
      if (msg.command === 'reconnect') connection?.reconnect();
      if (msg.command === 'pause') connection?.pause();
      if (msg.command === 'startNewConversation') connection?.startNewConversation();
    }
    if (msg?.type === 'renderedEventsResponse') {
      // Store the response from webview for testing/diagnostics
      renderedEventsInfo = { count: msg.count, eventTypes: msg.eventTypes };
    }
  };
}
