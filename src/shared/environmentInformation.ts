import * as path from 'path';
import * as fs from 'fs';

const toPosixPath = (value: string): string => value.replaceAll('\\', '/');

function normalizeFsPath(value: string): string {
  const resolved = path.resolve(value);
  try {
    const realpathSyncNative = (fs.realpathSync as unknown as { native?: (p: string) => string }).native;
    return typeof realpathSyncNative === 'function' ? realpathSyncNative(resolved) : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalizedRoot = normalizeFsPath(workspaceRoot);
  const normalizedFile = normalizeFsPath(filePath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

function getWorkspaceRelativePath(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(normalizeFsPath(workspaceRoot), normalizeFsPath(filePath));
  return toPosixPath(rel);
}

function formatWorkspaceLabel(relPath: string, basenameCounts: Map<string, number>): string {
  const basename = path.posix.basename(relPath);
  const count = basenameCounts.get(basename) ?? 0;
  if (count <= 1) return basename;

  const dir = path.posix.dirname(relPath);
  const disambiguator = dir && dir !== '.' ? dir : '(root)';
  return `${basename} — ${disambiguator}`;
}

export function formatEnvironmentInformation(params: {
  workspaceRoot?: string;
  activeEditorPath?: string | null;
  openEditorPaths: string[];
}): string {
  const workspaceRoot = params.workspaceRoot;
  const openEditorPaths = Array.from(new Set(params.openEditorPaths.filter((p) => typeof p === 'string' && p.trim().length > 0)));
  const resolvedOpenEditorPaths = openEditorPaths.map((p) => path.resolve(p));

  const allWorkspaceRelPaths: string[] = [];
  if (workspaceRoot) {
    for (const p of openEditorPaths) {
      if (isWithinWorkspace(p, workspaceRoot)) {
        allWorkspaceRelPaths.push(getWorkspaceRelativePath(p, workspaceRoot));
      }
    }
    const active = params.activeEditorPath ?? undefined;
    const resolvedActive = active ? path.resolve(active) : undefined;
    const isActiveAlreadyCounted = resolvedActive ? resolvedOpenEditorPaths.includes(resolvedActive) : false;
    if (active && !isActiveAlreadyCounted && isWithinWorkspace(active, workspaceRoot)) {
      allWorkspaceRelPaths.push(getWorkspaceRelativePath(active, workspaceRoot));
    }
  }

  const basenameCounts = new Map<string, number>();
  for (const rel of allWorkspaceRelPaths) {
    const basename = path.posix.basename(rel);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  const formatPath = (filePath: string): string => {
    if (workspaceRoot && isWithinWorkspace(filePath, workspaceRoot)) {
      const rel = getWorkspaceRelativePath(filePath, workspaceRoot);
      return formatWorkspaceLabel(rel, basenameCounts);
    }
    return filePath;
  };

  const activeEditorLabel = (() => {
    const activePath = params.activeEditorPath;
    if (!activePath) return 'none';
    return formatPath(activePath);
  })();

  const openEditorLabels = openEditorPaths.map((p) => formatPath(p));
  const openEditorsLines = openEditorLabels.length
    ? openEditorLabels.map((label) => `- ${label}`).join('\n')
    : '- none';

  return [
    '<environment information>',
    `Active editor: ${activeEditorLabel}`,
    'Open editors:',
    openEditorsLines,
    '</environment information>',
  ].join('\n');
}
