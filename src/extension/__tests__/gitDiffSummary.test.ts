import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { getGitHeadDiffSummaryForFile, resolveGitContext } from '../gitDiffSummary';

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function initRepo(repoDir: string): Promise<void> {
  await runGit(['init', '-b', 'main'], repoDir);
  await runGit(['config', 'user.email', 'test@example.com'], repoDir);
  await runGit(['config', 'user.name', 'Test User'], repoDir);
}

describe('gitDiffSummary', () => {
  it('returns (no HEAD available) for a file outside a git repo', async () => {
    const dir = await makeTempDir('openhands-tab-no-git-');
    try {
      const filePath = path.join(dir, 'a.txt');
      await fs.writeFile(filePath, 'hello');

      await expect(getGitHeadDiffSummaryForFile(filePath)).resolves.toBe('(no HEAD available)');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reports (no changes vs HEAD) for a tracked file with no modifications', async () => {
    const dir = await makeTempDir('openhands-tab-git-clean-');
    try {
      await initRepo(dir);
      const filePath = path.join(dir, 'foo.txt');
      await fs.writeFile(filePath, 'one\n');
      await runGit(['add', 'foo.txt'], dir);
      await runGit(['commit', '-m', 'init'], dir);

      await expect(getGitHeadDiffSummaryForFile(filePath)).resolves.toBe('(no changes vs HEAD)');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a git diff --stat summary for a modified tracked file', async () => {
    const dir = await makeTempDir('openhands-tab-git-dirty-');
    try {
      await initRepo(dir);
      const filePath = path.join(dir, 'foo.txt');
      await fs.writeFile(filePath, 'one\n');
      await runGit(['add', 'foo.txt'], dir);
      await runGit(['commit', '-m', 'init'], dir);

      await fs.appendFile(filePath, 'two\n');

      const summary = await getGitHeadDiffSummaryForFile(filePath);
      expect(summary).toContain('foo.txt');
      expect(summary).toMatch(/file changed/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns a helpful message for an untracked file inside a git repo', async () => {
    const dir = await makeTempDir('openhands-tab-git-untracked-');
    try {
      await initRepo(dir);

      const filePath = path.join(dir, 'untracked.txt');
      await fs.writeFile(filePath, 'hello');

      await expect(getGitHeadDiffSummaryForFile(filePath)).resolves.toBe('(no HEAD available: untracked file)');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves repo name/branch/remote for a git workspace', async () => {
    const dir = await makeTempDir('openhands-tab-git-context-');
    try {
      await initRepo(dir);

      // Create an initial commit so `git rev-parse --abbrev-ref HEAD` succeeds.
      await fs.writeFile(path.join(dir, 'README.md'), '# Test repo\n');
      await runGit(['add', 'README.md'], dir);
      await runGit(['commit', '-m', 'init'], dir);

      await runGit(['remote', 'add', 'origin', 'https://example.com/repo.git'], dir);

      const ctx = await resolveGitContext(dir);
      expect(ctx).toEqual({ repoName: path.basename(dir), branchName: 'main', remoteUrl: 'https://example.com/repo.git' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back gracefully when workspaceRoot is undefined', async () => {
    await expect(resolveGitContext(undefined)).resolves.toEqual({ repoName: 'unknown', branchName: 'unknown', remoteUrl: '' });
  });
});
