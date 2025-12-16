import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import picomatch from 'picomatch';

export type SearchWalkOptions = {
  includeHidden?: boolean;
  includeNodeModules?: boolean;
};

export const shouldSkipSearchEntry = (name: string, options: SearchWalkOptions = {}): boolean => {
  if (!options.includeHidden && name.startsWith('.')) return true;
  if (!options.includeNodeModules && name === 'node_modules') return true;
  return false;
};

export const listFilesRecursively = async (root: string, options: SearchWalkOptions = {}): Promise<string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (shouldSkipSearchEntry(entry.name, options)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const child = await listFilesRecursively(fullPath, options);
      results.push(...child);
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

export const normalizeSlashes = (value: string): string => value.split(path.sep).join('/');

export const normalizeGlobPattern = (pattern: string): string => {
  const cleaned = normalizeSlashes(pattern.trim());
  if (!cleaned) return '**/*';
  if (cleaned.includes('/')) return cleaned;
  return cleaned.startsWith('**/') ? cleaned : `**/${cleaned}`;
};

export const expandHome = (input: string): string => {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

export const createGlobMatcher = (pattern: string): ((value: string) => boolean) => {
  const matcher = picomatch(pattern, { dot: true }) as (value: string) => boolean;
  return (value: string) => Boolean(matcher(value));
};
