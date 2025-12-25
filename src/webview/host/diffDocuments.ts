import * as vscode from 'vscode';
import * as path from 'path';
import { resolveWorkspaceFilePath } from './workspacePaths';

const OPENHANDS_DIFF_SCHEME = 'openhands-diff';
const MAX_STORED_DIFF_DOCUMENTS = 60;

const diffContentByUri = new Map<string, string>();
const diffUriQueue: string[] = [];
let diffProviderRegistered = false;
let diffSequence = 0;

const diffEmitter = new vscode.EventEmitter<vscode.Uri>();
const diffProvider: vscode.TextDocumentContentProvider = {
  onDidChange: diffEmitter.event,
  provideTextDocumentContent: (uri) => diffContentByUri.get(uri.toString()) ?? '',
};

function ensureDiffProviderRegistered(context: vscode.ExtensionContext): void {
  if (diffProviderRegistered) return;
  diffProviderRegistered = true;
  context.subscriptions.push(diffEmitter);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(OPENHANDS_DIFF_SCHEME, diffProvider));
}

function storeDiffDocument(uri: vscode.Uri, content: string): void {
  const key = uri.toString();
  diffContentByUri.set(key, content);
  diffUriQueue.push(key);
  diffEmitter.fire(uri);

  while (diffUriQueue.length > MAX_STORED_DIFF_DOCUMENTS) {
    const drop = diffUriQueue.shift();
    if (drop) diffContentByUri.delete(drop);
  }
}

function createDiffUris(label: string): { beforeUri: vscode.Uri; afterUri: vscode.Uri } {
  const id = `${Date.now().toString(36)}-${(diffSequence++).toString(36)}`;
  const safeName = path.basename(label).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
  const beforeUri = vscode.Uri.parse(`${OPENHANDS_DIFF_SCHEME}:/before/${id}/${safeName}`);
  const afterUri = vscode.Uri.parse(`${OPENHANDS_DIFF_SCHEME}:/after/${id}/${safeName}`);
  return { beforeUri, afterUri };
}

export async function showWorkspaceDiff(args: {
  context: vscode.ExtensionContext;
  filePath: string;
  oldContent: string;
  newContent: string;
}): Promise<void> {
  ensureDiffProviderRegistered(args.context);

  const { resolvedPath, displayPath } = resolveWorkspaceFilePath(args.filePath);
  const { beforeUri } = createDiffUris(displayPath);
  const afterUri = vscode.Uri.file(resolvedPath);
  storeDiffDocument(beforeUri, args.oldContent);

  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `Diff: ${displayPath}`, { preview: false });
}
