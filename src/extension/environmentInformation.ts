import * as path from 'path';

const toPosixPath = (value: string): string => value.replaceAll('\\', '/');

function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedFile = path.resolve(filePath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

function getWorkspaceRelativePath(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, filePath);
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

  const allWorkspaceRelPaths: string[] = [];
  if (workspaceRoot) {
    for (const p of openEditorPaths) {
      if (isWithinWorkspace(p, workspaceRoot)) {
        allWorkspaceRelPaths.push(getWorkspaceRelativePath(p, workspaceRoot));
      }
    }
    const active = params.activeEditorPath ?? undefined;
    if (active && isWithinWorkspace(active, workspaceRoot)) {
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

