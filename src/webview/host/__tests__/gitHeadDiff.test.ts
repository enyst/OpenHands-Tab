import { describe, expect, it, vi } from 'vitest';
import { resolveGitHeadDiffContents } from '../gitHeadDiff';

describe('resolveGitHeadDiffContents', () => {
  it('prefers git HEAD ↔ working tree when available', async () => {
    const execFileText = vi.fn(async (_command: string, args: string[], _cwd?: string) => {
      if (args[0] === 'rev-parse') return '/repo\n';
      if (args[0] === 'show') return 'HEAD CONTENT';
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });
    const readFileText = vi.fn(async () => 'WORKING CONTENT');

    const result = await resolveGitHeadDiffContents({
      workspaceRoot: '/repo',
      resolvedPath: '/repo/README.md',
      fallbackOldContent: 'FALLBACK OLD',
      fallbackNewContent: 'FALLBACK NEW',
      execFileText,
      readFileText,
    });

    expect(result).toEqual({ oldContent: 'HEAD CONTENT', newContent: 'WORKING CONTENT', source: 'git_head' });
  });

  it('falls back to provided diff when git show fails', async () => {
    const execFileText = vi.fn(async (_command: string, args: string[], _cwd?: string) => {
      if (args[0] === 'rev-parse') return '/repo\n';
      if (args[0] === 'show') throw new Error('no such path');
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });
    const readFileText = vi.fn(async () => 'WORKING CONTENT');

    const result = await resolveGitHeadDiffContents({
      workspaceRoot: '/repo',
      resolvedPath: '/repo/README.md',
      fallbackOldContent: 'FALLBACK OLD',
      fallbackNewContent: 'FALLBACK NEW',
      execFileText,
      readFileText,
    });

    expect(result).toEqual({ oldContent: 'FALLBACK OLD', newContent: 'FALLBACK NEW', source: 'fallback' });
  });

  it('falls back when the path is outside the git root', async () => {
    const execFileText = vi.fn(async (_command: string, args: string[], _cwd?: string) => {
      if (args[0] === 'rev-parse') return '/repo\n';
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });
    const readFileText = vi.fn(async () => 'WORKING CONTENT');

    const result = await resolveGitHeadDiffContents({
      workspaceRoot: '/repo',
      resolvedPath: '/other/README.md',
      fallbackOldContent: 'FALLBACK OLD',
      fallbackNewContent: 'FALLBACK NEW',
      execFileText,
      readFileText,
    });

    expect(result).toEqual({ oldContent: 'FALLBACK OLD', newContent: 'FALLBACK NEW', source: 'fallback' });
  });

  it('falls back when workspaceRoot is unknown', async () => {
    const execFileText = vi.fn();
    const readFileText = vi.fn();

    const result = await resolveGitHeadDiffContents({
      workspaceRoot: undefined,
      resolvedPath: '/repo/README.md',
      fallbackOldContent: 'FALLBACK OLD',
      fallbackNewContent: 'FALLBACK NEW',
      execFileText,
      readFileText,
    });

    expect(result).toEqual({ oldContent: 'FALLBACK OLD', newContent: 'FALLBACK NEW', source: 'fallback' });
    expect(execFileText).not.toHaveBeenCalled();
    expect(readFileText).not.toHaveBeenCalled();
  });
});

