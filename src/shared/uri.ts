import * as vscode from 'vscode';

export function isFileBackedUri(uri: vscode.Uri | undefined | null): boolean {
  const scheme = typeof uri?.scheme === 'string' ? uri.scheme : '';
  return scheme === 'file' || scheme === 'vscode-remote';
}

export function getFileBackedFsPath(uri: vscode.Uri | undefined | null): string | undefined {
  if (!isFileBackedUri(uri)) return undefined;
  const fsPath = typeof uri?.fsPath === 'string' ? uri.fsPath.trim() : '';
  return fsPath || undefined;
}

