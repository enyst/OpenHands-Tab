import * as vscode from 'vscode';
import { getWebviewHtml } from '../webview/getWebviewHtml';

export type OpenHandsChatViewHandlers = {
  createMessageHandler: (view: vscode.WebviewView) => (msg: unknown) => void;
  onResolved: (view: vscode.WebviewView) => void;
  onDisposed: () => void;
};

export class OpenHandsChatViewProvider implements vscode.WebviewViewProvider {
  private viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly handlers: OpenHandsChatViewHandlers
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.viewDisposables.forEach((d) => d.dispose());
    this.viewDisposables = [];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = getWebviewHtml(this.context, webviewView.webview);

    const messageHandler = this.handlers.createMessageHandler(webviewView);
    this.viewDisposables.push(webviewView.webview.onDidReceiveMessage(messageHandler));
    this.viewDisposables.push(webviewView.onDidDispose(() => this.handlers.onDisposed()));

    this.handlers.onResolved(webviewView);
  }
}
