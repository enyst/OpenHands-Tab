import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';

let panel: vscode.WebviewPanel | undefined;
let connection: ConnectionManager | undefined;

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
      const savedId = context.workspaceState.get<string>('openhands.conversationId');
      if (savedId) connection.restoreConversation(savedId);
    }

    panel?.reveal();
  }

  const openTab = vscode.commands.registerCommand('openhands.openTab', async () => {
    await ensurePanelAndConnection();
  });

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await ensurePanelAndConnection();
    await connection?.startNewConversation();
  });

  const configure = vscode.commands.registerCommand('openhands.configure', async () => {
    const current = vscode.workspace.getConfiguration().get<string>('openhands.serverUrl') ?? 'http://localhost:3000';
    const input = await vscode.window.showInputBox({
      title: 'OpenHands Server URL',
      value: current,
      placeHolder: 'http://localhost:3000'
    });
    if (input) {
      await vscode.workspace.getConfiguration().update('openhands.serverUrl', input, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`OpenHands server URL set to ${input}`);
      panel?.webview.postMessage({ type: 'configUpdated', serverUrl: input });
      connection?.setServerUrl(input);
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

  context.subscriptions.push(openTab, startNew, configure, reconnect, pause);
}

export function deactivate() {
  connection?.disconnect();
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.css'));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${stylesUri}" rel="stylesheet" />
  <title>OpenHands Tab</title>
</head>
<body>
  <div id="app">
    <header>
      <span id="status" class="status offline"></span>
      <h1>OpenHands</h1>
      <button id="settingsBtn">Settings</button>
    </header>
    <main id="messages"></main>
    <footer>
      <textarea id="input" rows="2" placeholder="Type a message..."></textarea>
      <button id="sendBtn">Send</button>
      <button id="stopBtn">Stop</button>
    </footer>
  </div>
  <script type="module" src="${scriptUri}"></script>
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
  };
}
