import * as vscode from 'vscode';

export function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'index.css'));
  const codiconStylesUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'codicon.css'));
  const mediaBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media'));
  const version = Date.now().toString();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `media-src ${webview.cspSource} blob:`,
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
  <meta name="openhands-media-base" content="${mediaBaseUri.toString()}">
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
