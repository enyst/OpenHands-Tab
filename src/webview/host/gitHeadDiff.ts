import * as path from 'path';

export type DiffContentsSource = 'git_head' | 'fallback';

export type DiffContents = {
  oldContent: string;
  newContent: string;
  source: DiffContentsSource;
};

export type ResolveGitHeadDiffContentsArgs = {
  workspaceRoot: string | undefined;
  resolvedPath: string;
  fallbackOldContent: string;
  fallbackNewContent: string;
  execFileText: (command: string, args: string[], cwd?: string) => Promise<string>;
  readFileText: (filePath: string) => Promise<string>;
};

export async function resolveGitHeadDiffContents(args: ResolveGitHeadDiffContentsArgs): Promise<DiffContents> {
  const fallback = (): DiffContents => ({
    oldContent: args.fallbackOldContent,
    newContent: args.fallbackNewContent,
    source: 'fallback',
  });

  if (!args.workspaceRoot) return fallback();

  let gitRoot = '';
  try {
    gitRoot = (await args.execFileText('git', ['rev-parse', '--show-toplevel'], args.workspaceRoot)).trim();
  } catch {
    return fallback();
  }
  if (!gitRoot) return fallback();

  const relativePath = path.relative(gitRoot, args.resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return fallback();
  }

  const gitPath = relativePath.split(path.sep).join('/');

  let oldContent: string;
  let newContent: string;

  try {
    oldContent = await args.execFileText('git', ['show', `HEAD:${gitPath}`], gitRoot);
  } catch {
    return fallback();
  }

  try {
    newContent = await args.readFileText(args.resolvedPath);
  } catch {
    return fallback();
  }

  return { oldContent, newContent, source: 'git_head' };
}

