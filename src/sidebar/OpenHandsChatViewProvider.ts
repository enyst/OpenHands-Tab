import * as vscode from 'vscode';
import { getWebviewHtml } from '../webview/getWebviewHtml';

export class OpenHandsChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = getWebviewHtml(this.context, webviewView.webview);
  }
}

