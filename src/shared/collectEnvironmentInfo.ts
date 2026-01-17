import * as vscode from 'vscode';
import { collectOpenEditorPaths } from './openEditors';
import { getFileBackedFsPath } from './uri';
import { resolvePreferredWorkspaceRoot } from './workspaceRoot';

export type CollectedEnvironmentInfo = {
  workspaceRoot?: string;
  activeEditorPath: string | null;
  openEditorPaths: string[];
};

export function collectEnvironmentInfo(params?: { maxOpenEditorPaths?: number }): CollectedEnvironmentInfo {
  const workspaceRoot = resolvePreferredWorkspaceRoot();
  const activeEditorPath = getFileBackedFsPath(vscode.window.activeTextEditor?.document?.uri) ?? null;
  const openEditorPaths = collectOpenEditorPaths({ activeEditorPath, max: params?.maxOpenEditorPaths ?? 15 });

  return { workspaceRoot, activeEditorPath, openEditorPaths };
}

