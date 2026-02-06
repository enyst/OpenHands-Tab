import * as fs from 'fs';
import { mkdir } from 'node:fs/promises';
import path from 'path';

export type AllowedRootKind = 'dir' | 'file';

const isPathContainedInRoot = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

export const normalizeExistingOrParent = (candidate: string): string => {
  const parsed = path.parse(candidate);
  const root = parsed.root;
  const parts = candidate
    .slice(root.length)
    .split(path.sep)
    .filter((part) => part.length > 0);

  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(current, parts[i]);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(next);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        const remaining = parts.slice(i).join(path.sep);
        return remaining ? path.join(current, remaining) : current;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      // Treat symlink components as hostile: require them to resolve now.
      current = fs.realpathSync(next);
      continue;
    }
    current = next;
  }
  return current;
};

export const resolveAllowedPath = (
  targetPath: string,
  workspaceRoot: string,
  allowedRoots: ReadonlyMap<string, AllowedRootKind>,
): string => {
  const candidate = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(workspaceRoot, targetPath);
  const normalized = normalizeExistingOrParent(candidate);

  for (const [root, kind] of allowedRoots.entries()) {
    if (kind === 'file') {
      if (normalized === root) return normalized;
      continue;
    }
    if (isPathContainedInRoot(root, normalized)) return normalized;
  }

  throw new Error(`Path escapes workspace root: ${targetPath}`);
};

export const findContainingDirRoot = (
  resolvedPath: string,
  allowedRoots: ReadonlyMap<string, AllowedRootKind>,
): string | null => {
  let best: string | null = null;

  for (const [root, kind] of allowedRoots.entries()) {
    if (kind !== 'dir') continue;
    if (isPathContainedInRoot(root, resolvedPath)) {
      if (!best || root.length > best.length) best = root;
    }
  }

  return best;
};

export const ensureSafeDirectory = async (root: string, dirPath: string): Promise<void> => {
  const relative = path.relative(root, dirPath);
  if (relative === '' || relative === '.') return;
  if (!isPathContainedInRoot(root, dirPath)) {
    throw new Error(`Path escapes workspace root: ${dirPath}`);
  }

  const assertContained = (candidate: string) => {
    if (!isPathContainedInRoot(root, candidate)) {
      throw new Error(`Path escapes workspace root: ${dirPath}`);
    }
  };

  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  let current = root;

  for (const part of parts) {
    let currentStat: fs.Stats;
    try {
      currentStat = await fs.promises.lstat(current);
    } catch {
      throw new Error(`Path escapes workspace root: ${dirPath}`);
    }

    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
      throw new Error(`Path escapes workspace root: ${dirPath}`);
    }
    assertContained(current);

    let next = path.join(current, part);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(next);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        // Re-check the parent directory immediately before creating the next component.
        // This closes a TOCTTOU window where the parent can be swapped to a symlink between
        // validation and mkdir, causing `mkdir(next)` to escape the workspace root.
        try {
          currentStat = await fs.promises.lstat(current);
        } catch {
          throw new Error(`Path escapes workspace root: ${dirPath}`);
        }
        if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
          throw new Error(`Path escapes workspace root: ${dirPath}`);
        }
        assertContained(current);
        next = path.join(current, part);

        try {
          await mkdir(next);
        } catch (mkdirError) {
          if (typeof mkdirError !== 'object' || !mkdirError || !('code' in mkdirError) || (mkdirError as { code?: unknown }).code !== 'EEXIST') {
            throw mkdirError;
          }
        }
        stat = await fs.promises.lstat(next);
      } else {
        throw error;
      }
    }

    if (stat.isSymbolicLink()) {
      const resolved = await fs.promises.realpath(next);
      assertContained(resolved);

      let resolvedStat: fs.Stats;
      try {
        resolvedStat = await fs.promises.stat(resolved);
      } catch {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }
      if (!resolvedStat.isDirectory()) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }

      current = resolved;
      continue;
    }

    if (!stat.isDirectory()) {
      throw new Error(`Path escapes workspace root: ${dirPath}`);
    }
    current = next;
  }
};

interface RevalidateDirectoryArgs {
  operation: string;
  verb: string;
  subject: string;
  directoryPath: string;
  absPath: string;
  expectedCanonicalDir: string;
  containingRoot?: string;
  options: { requireDirectory: boolean; throwIfMissing: boolean; notDirectorySubject?: string };
}

export const revalidateDirectory = async ({
  operation,
  verb,
  subject,
  directoryPath,
  absPath,
  expectedCanonicalDir,
  containingRoot,
  options,
}: RevalidateDirectoryArgs): Promise<string> => {
  let parentStat: fs.Stats;
  try {
    parentStat = await fs.promises.lstat(directoryPath);
  } catch (error) {
    if (
      options.throwIfMissing
      && typeof error === 'object'
      && error
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT'
    ) {
      throw new Error(`${operation} failed: ${subject} does not exist: ${directoryPath}`);
    }
    throw error;
  }

  if (parentStat.isSymbolicLink()) {
    throw new Error(`${operation} failed: refusing to ${verb} through symlink ${subject}: ${directoryPath}`);
  }
  if (options.requireDirectory && !parentStat.isDirectory()) {
    const notDirectorySubject = options.notDirectorySubject ?? subject;
    throw new Error(`${operation} failed: ${notDirectorySubject} is not a directory: ${directoryPath}`);
  }

  const canonicalDir = await fs.promises.realpath(directoryPath);
  if (containingRoot && !isPathContainedInRoot(containingRoot, canonicalDir)) {
    throw new Error(`Path escapes workspace root: ${absPath}`);
  }
  if (canonicalDir !== expectedCanonicalDir) {
    throw new Error(`${operation} failed: ${subject} changed during ${verb}: ${directoryPath}`);
  }

  return canonicalDir;
};
