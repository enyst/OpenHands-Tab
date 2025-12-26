import * as childProcess from 'child_process';
import * as path from 'path';

function execFileText(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : err.message;
        reject(new Error(message));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

export async function getGitHeadDiffSummaryForFile(filePath: string): Promise<string> {
  const cwd = path.dirname(filePath);
  let root: string;
  try {
    root = (await execFileText('git', ['rev-parse', '--show-toplevel'], cwd)).trim();
  } catch {
    return '(no HEAD available)';
  }

  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return '(no HEAD available)';
  }

  const isTracked = await execFileText('git', ['ls-files', '--error-unmatch', '--', relative], root)
    .then(() => true)
    .catch(() => false);
  if (!isTracked) {
    return '(no HEAD available: untracked file)';
  }

  try {
    const stat = await execFileText('git', ['diff', '--no-color', '--stat', 'HEAD', '--', relative], root);
    const trimmed = stat.trim();
    if (!trimmed) return '(no changes vs HEAD)';
    const maxChars = 2000;
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n…(truncated)` : trimmed;
  } catch {
    return '(no HEAD available)';
  }
}

export async function resolveGitContext(workspaceRoot: string | undefined): Promise<{ repoName: string; branchName: string }> {
  const fallbackRepo = workspaceRoot ? path.basename(workspaceRoot) : 'unknown';
  if (!workspaceRoot) return { repoName: fallbackRepo, branchName: 'unknown' };

  try {
    const root = (await execFileText('git', ['rev-parse', '--show-toplevel'], workspaceRoot)).trim();
    const branch = (await execFileText('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root)).trim();
    return { repoName: path.basename(root) || fallbackRepo, branchName: branch || 'unknown' };
  } catch {
    return { repoName: fallbackRepo, branchName: 'unknown' };
  }
}
