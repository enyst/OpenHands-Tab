import type * as vscode from 'vscode';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { CreateWebviewMessageHandlerDeps } from '../createWebviewMessageHandler';

export function handleWebviewConsole(args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'webviewConsole' }>;
}): void {
  if (!args.deps.isDevBridgeEnabled()) return;
  args.outputChannel?.appendLine(`[webview ${args.message.level}] ${args.message.args.join(' ')}`);
  args.deps.fileLog(`[console.${args.message.level}] ${args.message.args.join(' ')}`);
}

export function handleWebviewError(args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'webviewError' }>;
}): void {
  if (!args.deps.isDevBridgeEnabled()) return;
  args.outputChannel?.appendLine(`[webview error] ${args.message.message}`);
  if (args.message.stack) args.outputChannel?.appendLine(args.message.stack);
  args.deps.fileLog(`[error] ${args.message.message}${args.message.stack ? `\n${args.message.stack}` : ''}`);
}

export function handleWebviewNetwork(args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'webviewNetwork' }>;
}): void {
  if (!args.deps.isDevBridgeEnabled()) return;
  const line = `[webview net] ${args.message.phase} id=${args.message.id} ${args.message.method} ${args.message.url}${args.message.status !== undefined ? ` status=${args.message.status} ok=${args.message.ok}` : ''}`;
  args.outputChannel?.appendLine(line);
  args.deps.fileLog(line);
}

export function handleWebviewWebSocket(args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
  message: Extract<WebviewToHostMessage, { type: 'webviewWebSocket' }>;
}): void {
  if (!args.deps.isDevBridgeEnabled()) return;
  const parts = [`[webview ws] ${args.message.phase}`];
  if (args.message.url) parts.push(`url=${args.message.url}`);
  if (args.message.code !== undefined) parts.push(`code=${args.message.code}`);
  if (args.message.reason) parts.push(`reason=${args.message.reason}`);
  args.outputChannel?.appendLine(parts.join(' '));
  args.deps.fileLog(parts.join(' '));
}

