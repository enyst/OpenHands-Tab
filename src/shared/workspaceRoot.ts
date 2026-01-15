import * as vscode from 'vscode';

export const resolvePreferredWorkspaceFolderUri = (): vscode.Uri | undefined => {
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const getWorkspaceFolder = (vscode.workspace as unknown as { getWorkspaceFolder?: (uri: vscode.Uri) => { uri?: vscode.Uri } | undefined })
    .getWorkspaceFolder;

  if (activeUri && typeof getWorkspaceFolder === 'function') {
    try {
      const folder = getWorkspaceFolder(activeUri);
      const uri = folder?.uri;
      if (uri) return uri;
    } catch {
      // ignore and fall back
    }
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0]?.uri;

  return undefined;
};

export const resolvePreferredWorkspaceRoot = (): string | undefined => {
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const getWorkspaceFolder = (vscode.workspace as unknown as { getWorkspaceFolder?: (uri: vscode.Uri) => { uri?: vscode.Uri } | undefined })
    .getWorkspaceFolder;

  if (activeUri && typeof getWorkspaceFolder === 'function') {
    try {
      const folder = getWorkspaceFolder(activeUri);
      const fsPath = folder?.uri?.fsPath;
      if (typeof fsPath === 'string' && fsPath.trim().length > 0) return fsPath;
    } catch {
      // ignore and fall back
    }
  }

  const first = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  return typeof first === 'string' && first.trim().length > 0 ? first : undefined;
};

export const getEffectiveWorkspaceRoot = (): string | undefined => {
  return resolvePreferredWorkspaceRoot();
};
