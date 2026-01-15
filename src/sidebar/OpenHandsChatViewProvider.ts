import * as vscode from 'vscode';
import { getWebviewHtml } from '../webview/getWebviewHtml';

export type OpenHandsChatViewHandlers = {
  createMessageHandler: (view: vscode.WebviewView) => (msg: unknown) => void;
  onResolved: (view: vscode.WebviewView) => void;
  onVisibilityChange?: (view: vscode.WebviewView, visible: boolean) => void;
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
      try { d.dispose(); } catch (err) {
        console.warn('[OpenHands] Failed to dispose a view disposable:', err);
      }
    });
    this.viewDisposables = [];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewDisposables();

    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const pastedImagesRoot = vscode.Uri.joinPath(this.context.globalStorageUri, 'pasted-images');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, pastedImagesRoot],
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

    const onDidChangeVisibility = (webviewView as unknown as { onDidChangeVisibility?: (listener: () => void) => vscode.Disposable })
      .onDidChangeVisibility;
    if (typeof onDidChangeVisibility === 'function') {
      this.viewDisposables.push(onDidChangeVisibility(() => {
        this.handlers.onVisibilityChange?.(webviewView, Boolean(webviewView.visible));
      }));
    }

    this.handlers.onResolved(webviewView);
  }
}
