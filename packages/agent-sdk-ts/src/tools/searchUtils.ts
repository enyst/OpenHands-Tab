import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import picomatch from 'picomatch';

export type SearchWalkOptions = {
  includeHidden?: boolean;
  includeNodeModules?: boolean;
  maxDepth?: number;
};

export const shouldSkipSearchEntry = (name: string, options: SearchWalkOptions = {}): boolean => {
  if (options.includeHidden !== true && name.startsWith('.')) return true;
  if (options.includeNodeModules !== true && name === 'node_modules') return true;
  return false;
};

const listFilesRecursivelyInternal = async (
  root: string,
  options: SearchWalkOptions,
  depth: number,
): Promise<string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (shouldSkipSearchEntry(entry.name, options)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const maxDepth = options.maxDepth;
      if (typeof maxDepth === 'number' && depth >= maxDepth) continue;
      const child = await listFilesRecursivelyInternal(fullPath, options, depth + 1);
      results.push(...child);
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

export const listFilesRecursively = async (root: string, options: SearchWalkOptions = {}): Promise<string[]> =>
  listFilesRecursivelyInternal(root, options, 0);

export const normalizeSlashes = (value: string): string => value.split(path.sep).join('/');

export const normalizeGlobPattern = (pattern: string): string => {
  const cleaned = normalizeSlashes(pattern.trim());
  if (!cleaned) return '**/*';
  return cleaned;
};

export const expandHome = (input: string): string => {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

const SEGMENT_HAS_GLOB_MAGIC = /[*?[\]{}()!]/;

export type GlobWalkPlan = {
  walkRoot: string;
  matcherPattern: string;
  maxDepth?: number;
};

export const planGlobWalk = (searchRoot: string, pattern: string): GlobWalkPlan => {
  const normalized = normalizeGlobPattern(pattern);
  const parts = normalized.split('/').filter((part) => part.length > 0);

  const staticPrefix: string[] = [];
  for (const part of parts) {
    if (part === '**') break;
    if (SEGMENT_HAS_GLOB_MAGIC.test(part)) break;
    staticPrefix.push(part);
  }

  const remainder = parts.slice(staticPrefix.length);
  const walkRoot = staticPrefix.length > 0 && remainder.length > 0 ? path.join(searchRoot, ...staticPrefix) : searchRoot;
  const matcherPattern = staticPrefix.length > 0 && remainder.length > 0 ? remainder.join('/') : normalized;

  const matcherParts = matcherPattern.split('/').filter((part) => part.length > 0);
  const hasGlobStar = matcherParts.some((part) => part === '**' || part.includes('**'));
  const maxDepth = hasGlobStar ? undefined : Math.max(0, matcherParts.length - 1);

  return { walkRoot, matcherPattern, maxDepth };
};

export const createGlobMatcher = (pattern: string): ((value: string) => boolean) => {
  const matcher = picomatch(pattern, { dot: true }) as (value: string) => boolean;
  return (value: string) => Boolean(matcher(value));
};
