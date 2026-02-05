import * as vscode from 'vscode';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import { resolvePreferredWorkspaceFolderUri } from '../../../shared/workspaceRoot';
import { toAttachmentLabel } from '../attachments';
import type { WebviewHost } from '../webviewMessageHandler.types';

export async function handleSelectAttachments(args: {
  context: vscode.ExtensionContext;
  host: WebviewHost;
  message: Extract<WebviewToHostMessage, { type: 'selectAttachments' }>;
}): Promise<void> {
  try {
    const extensionMode = vscode.ExtensionMode;
    const isTestMode =
      extensionMode?.Test !== undefined &&
      args.context.extensionMode === extensionMode.Test;
    if (isTestMode && process.env.E2E_MOCK_ATTACHMENTS === '1') {
      const mockUris = [vscode.Uri.joinPath(args.context.extensionUri, 'README.md')];
      const attachments = await Promise.all(
        mockUris.map(async (uri) => {
          const label = toAttachmentLabel(uri);
          let sizeBytes: number | undefined;
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            sizeBytes = stat.size;
          } catch (err) {
            console.warn('[OpenHands] Failed to stat attachment', err);
          }
          return { uri: uri.toString(), label, sizeBytes };
        })
      );
      void args.host.postMessage({ type: 'attachmentsSelected', attachments });
      return;
    }

    const defaultUri = resolvePreferredWorkspaceFolderUri();
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      defaultUri,
      openLabel: 'Attach',
    });
    if (!picked || picked.length === 0) return;

    const attachments = await Promise.all(
      picked.map(async (uri) => {
        const label = toAttachmentLabel(uri);
        let sizeBytes: number | undefined;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          sizeBytes = stat.size;
        } catch (err) {
          console.warn('[OpenHands] Failed to stat attachment', err);
        }
        return { uri: uri.toString(), label, sizeBytes };
      })
    );
    void args.host.postMessage({ type: 'attachmentsSelected', attachments });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to select attachments: ${reason}`);
  }
}

export async function handleOpenAttachment(message: Extract<WebviewToHostMessage, { type: 'openAttachment' }>): Promise<void> {
  const raw = message.uri;
  if (!raw) return;
  try {
    const uri = vscode.Uri.parse(raw, true);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to open attachment: ${reason}`);
  }
}
