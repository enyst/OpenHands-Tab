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

  private disposeViewDisposables(): void {
    this.viewDisposables.forEach((d) => {
      try { d.dispose(); } catch { }
    });
    this.viewDisposables = [];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewDisposables();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewView.webview.html = getWebviewHtml(this.context, webviewView.webview);

    const messageHandler = this.handlers.createMessageHandler(webviewView);
    this.viewDisposables.push(webviewView.webview.onDidReceiveMessage(messageHandler));
    this.viewDisposables.push(
      webviewView.onDidDispose(() => {
        this.disposeViewDisposables();
        this.handlers.onDisposed();
      })
    );

    this.handlers.onResolved(webviewView);
  }
}
