import * as vscode from 'vscode';
import * as path from 'path';

export function resolveWorkspaceFilePath(inputPath: string): { resolvedPath: string; displayPath: string } {
  const isAbs = path.isAbsolute(inputPath);
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  let resolvedPath: string;
  if (!isAbs && wsRoot) {
    const candidate = path.resolve(wsRoot, inputPath);
    const rel = path.relative(wsRoot, candidate);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      resolvedPath = candidate;
    } else {
      resolvedPath = path.resolve(inputPath);
    }
  } else {
    resolvedPath = path.resolve(inputPath);
  }

  if (!wsRoot) {
    return { resolvedPath, displayPath: resolvedPath };
  }
  const rel = path.relative(wsRoot, resolvedPath);
  const displayPath = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : resolvedPath;
  return { resolvedPath, displayPath };
}

