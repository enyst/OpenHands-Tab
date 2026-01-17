import * as path from 'path';
import * as vscode from 'vscode';
import { getFileBackedFsPath } from './uri';

function isUriLike(value: unknown): value is vscode.Uri {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { scheme?: unknown }).scheme === 'string'
    && typeof (value as { fsPath?: unknown }).fsPath === 'string';
}

function extractUriFromTabInput(input: unknown): vscode.Uri | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const maybeUri = (input as { uri?: unknown }).uri;
  if (isUriLike(maybeUri)) return maybeUri;

  const maybeModified = (input as { modified?: unknown }).modified;
  if (isUriLike(maybeModified)) return maybeModified;

  const maybeResource = (input as { resource?: unknown }).resource;
  if (isUriLike(maybeResource)) return maybeResource;

  return undefined;
}

function collectOpenEditorPathsFromTabs(): string[] {
  const groups = vscode.window.tabGroups?.all;
  if (!Array.isArray(groups)) return [];

  const paths: string[] = [];
  for (const group of groups) {
    const tabs = (group as { tabs?: unknown }).tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      const uri = extractUriFromTabInput((tab as { input?: unknown }).input);
      const fsPath = getFileBackedFsPath(uri);
      if (fsPath) paths.push(fsPath);
    }
  }
  return paths;
}

function collectOpenEditorPathsFromVisibleEditors(): string[] {
  return (vscode.window.visibleTextEditors ?? [])
    .map((e) => getFileBackedFsPath(e?.document?.uri))
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function collectOpenEditorPaths(params: {
  activeEditorPath?: string | null;
  max?: number;
}): string[] {
  const max = params.max ?? Number.POSITIVE_INFINITY;
  const activeEditorPath = typeof params.activeEditorPath === 'string' ? params.activeEditorPath : null;
  const resolvedActive = activeEditorPath ? path.resolve(activeEditorPath) : null;

  const candidates = collectOpenEditorPathsFromTabs();
  const raw = candidates.length > 0 ? candidates : collectOpenEditorPathsFromVisibleEditors();

  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of raw) {
    const resolved = path.resolve(p);
    if (resolvedActive && resolved === resolvedActive) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(p);
    if (result.length >= max) break;
  }

  return result;
}
