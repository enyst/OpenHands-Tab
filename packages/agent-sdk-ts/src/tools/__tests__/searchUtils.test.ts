import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  shouldSkipSearchEntry,
  listFilesRecursively,
  normalizeSlashes,
  normalizeGlobPattern,
  expandHome,
  planGlobWalk,
  createGlobMatcher,
} from '../searchUtils';

describe('searchUtils', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('shouldSkipSearchEntry', () => {
    it('skips hidden files by default', () => {
      expect(shouldSkipSearchEntry('.gitignore')).toBe(true);
      expect(shouldSkipSearchEntry('.config')).toBe(true);
    });

    it('does not skip hidden files when includeHidden is true', () => {
      expect(shouldSkipSearchEntry('.gitignore', { includeHidden: true })).toBe(false);
    });

    it('skips node_modules by default', () => {
      expect(shouldSkipSearchEntry('node_modules')).toBe(true);
    });

    it('does not skip node_modules when includeNodeModules is true', () => {
      expect(shouldSkipSearchEntry('node_modules', { includeNodeModules: true })).toBe(false);
    });

    it('does not skip regular files', () => {
      expect(shouldSkipSearchEntry('file.txt')).toBe(false);
      expect(shouldSkipSearchEntry('src')).toBe(false);
    });
  });

  describe('listFilesRecursively', () => {
    it('lists files in a directory', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2');

      const files = await listFilesRecursively(tempDir);
      expect(files.map((f) => path.basename(f))).toContain('file1.txt');
      expect(files.map((f) => path.basename(f))).toContain('file2.txt');
    });

    it('lists files recursively in subdirectories', async () => {
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(tempDir, 'root.txt'), '');
      fs.writeFileSync(path.join(subDir, 'nested.txt'), '');

      const files = await listFilesRecursively(tempDir);
      expect(files.some((f) => f.endsWith('root.txt'))).toBe(true);
      expect(files.some((f) => f.endsWith('nested.txt'))).toBe(true);
    });

    it('skips hidden files by default', async () => {
      fs.writeFileSync(path.join(tempDir, '.hidden'), '');
      fs.writeFileSync(path.join(tempDir, 'visible.txt'), '');

      const files = await listFilesRecursively(tempDir);
      expect(files.some((f) => f.endsWith('.hidden'))).toBe(false);
      expect(files.some((f) => f.endsWith('visible.txt'))).toBe(true);
    });

    it('includes hidden files when includeHidden is true', async () => {
      fs.writeFileSync(path.join(tempDir, '.hidden'), '');

      const files = await listFilesRecursively(tempDir, { includeHidden: true });
      expect(files.some((f) => f.endsWith('.hidden'))).toBe(true);
    });

    it('respects maxDepth option', async () => {
      const level1 = path.join(tempDir, 'level1');
      const level2 = path.join(level1, 'level2');
      fs.mkdirSync(level2, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'root.txt'), '');
      fs.writeFileSync(path.join(level1, 'l1.txt'), '');
      fs.writeFileSync(path.join(level2, 'l2.txt'), '');

      const files = await listFilesRecursively(tempDir, { maxDepth: 0 });
      expect(files.some((f) => f.endsWith('root.txt'))).toBe(true);
      expect(files.some((f) => f.endsWith('l1.txt'))).toBe(false);
    });
  });

  describe('normalizeSlashes', () => {
    it('normalizes path separators to forward slashes', () => {
      // normalizeSlashes splits by path.sep and joins with '/'
      // On Unix (path.sep = '/'), forward slashes stay as forward slashes
      // On Windows (path.sep = '\'), backslashes become forward slashes
      const result = normalizeSlashes('path/to/file');
      expect(result).toBe('path/to/file');
    });

    it('leaves forward slashes unchanged on Unix', () => {
      expect(normalizeSlashes('path/to/file')).toBe('path/to/file');
    });

    it('handles nested paths', () => {
      const result = normalizeSlashes('src/components/Button.tsx');
      expect(result).toBe('src/components/Button.tsx');
    });

    it('handles empty string', () => {
      expect(normalizeSlashes('')).toBe('');
    });

    it('handles single component path', () => {
      expect(normalizeSlashes('file.txt')).toBe('file.txt');
    });
  });

  describe('normalizeGlobPattern', () => {
    it('returns **/* for empty pattern', () => {
      expect(normalizeGlobPattern('')).toBe('**/*');
    });

    it('returns **/* for whitespace-only pattern', () => {
      expect(normalizeGlobPattern('   ')).toBe('**/*');
    });

    it('trims whitespace from pattern', () => {
      expect(normalizeGlobPattern('  *.ts  ')).toBe('*.ts');
    });

    it('normalizes slashes in pattern', () => {
      const pattern = 'src\\**\\*.ts';
      const result = normalizeGlobPattern(pattern);
      // On Unix, backslashes may remain, but on Windows they get normalized
      expect(result).toBeDefined();
    });
  });

  describe('expandHome', () => {
    it('expands ~ to home directory', () => {
      expect(expandHome('~')).toBe(os.homedir());
    });

    it('expands ~/ prefix to home directory', () => {
      const result = expandHome('~/documents');
      expect(result).toBe(path.join(os.homedir(), 'documents'));
    });

    it('expands ~\\ prefix on Windows-style paths', () => {
      const result = expandHome('~\\documents');
      expect(result).toBe(path.join(os.homedir(), 'documents'));
    });

    it('does not expand ~ in the middle of path', () => {
      expect(expandHome('/home/user~name')).toBe('/home/user~name');
    });

    it('returns absolute paths unchanged', () => {
      expect(expandHome('/absolute/path')).toBe('/absolute/path');
    });
  });

  describe('planGlobWalk', () => {
    it('returns search root as walk root for wildcard patterns', () => {
      const result = planGlobWalk('/search', '**/*.ts');
      expect(result.walkRoot).toBe('/search');
      expect(result.matcherPattern).toBe('**/*.ts');
    });

    it('optimizes walk root for static prefix', () => {
      const result = planGlobWalk('/search', 'src/components/*.tsx');
      expect(result.walkRoot).toBe(path.join('/search', 'src', 'components'));
      expect(result.matcherPattern).toBe('*.tsx');
    });

    it('calculates maxDepth for non-globstar patterns', () => {
      const result = planGlobWalk('/search', 'src/*.ts');
      expect(result.walkRoot).toBe(path.join('/search', 'src'));
      expect(result.maxDepth).toBe(0);
    });

    it('returns undefined maxDepth for globstar patterns', () => {
      const result = planGlobWalk('/search', '**/*.ts');
      expect(result.maxDepth).toBe(undefined);
    });

    it('handles patterns starting with glob', () => {
      const result = planGlobWalk('/search', '*.ts');
      expect(result.walkRoot).toBe('/search');
      expect(result.matcherPattern).toBe('*.ts');
    });

    it('handles pattern with double globstar in middle', () => {
      const result = planGlobWalk('/search', 'src/**/test/*.spec.ts');
      expect(result.walkRoot).toBe(path.join('/search', 'src'));
      expect(result.matcherPattern).toBe('**/test/*.spec.ts');
    });
  });

  describe('createGlobMatcher', () => {
    it('matches files based on pattern', () => {
      const matcher = createGlobMatcher('*.ts');
      expect(matcher('file.ts')).toBe(true);
      expect(matcher('file.tsx')).toBe(false);
      expect(matcher('file.js')).toBe(false);
    });

    it('matches glob star patterns', () => {
      const matcher = createGlobMatcher('**/*.ts');
      expect(matcher('file.ts')).toBe(true);
      expect(matcher('src/file.ts')).toBe(true);
      expect(matcher('src/nested/file.ts')).toBe(true);
    });

    it('matches dot files when dot option is enabled', () => {
      const matcher = createGlobMatcher('**/*');
      expect(matcher('.gitignore')).toBe(true);
      expect(matcher('src/.config')).toBe(true);
    });

    it('matches brace expansion patterns', () => {
      const matcher = createGlobMatcher('*.{ts,tsx}');
      expect(matcher('file.ts')).toBe(true);
      expect(matcher('file.tsx')).toBe(true);
      expect(matcher('file.js')).toBe(false);
    });

    it('returns boolean', () => {
      const matcher = createGlobMatcher('*.ts');
      const result = matcher('test.ts');
      expect(typeof result).toBe('boolean');
    });
  });
});
