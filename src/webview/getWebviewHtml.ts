import * as vscode from 'vscode';

export function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'index.css'));
  const codiconStylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'codicon.css'));
  const mediaBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media'));
  const version = Date.now().toString();
  const extensionMode = vscode.ExtensionMode;
  const isProduction =
    extensionMode?.Production !== undefined ? context.extensionMode === extensionMode.Production : true;
  const e2eEnabled = !isProduction && process.env.E2E_UI === '1';
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `media-src ${webview.cspSource} blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    // VS Code webviews rely on a service worker; allow it explicitly.
    `worker-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="openhands-media-base" content="${mediaBaseUri.toString()}">
  ${e2eEnabled ? '<meta name="openhands-e2e" content="1">' : ''}
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
