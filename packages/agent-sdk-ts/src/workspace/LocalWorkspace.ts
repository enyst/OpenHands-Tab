import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';
import * as fs from 'fs';
import { readFile as readFileAsync, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'path';
import os from 'os';

type WorkspaceEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';
type EnvVars = Record<string, string | undefined>;

export interface CommandOptions {
  cwd?: string;
  env?: EnvVars;
  timeoutMs?: number;
  shell?: string | boolean;
}

export interface CommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

type AllowedRootKind = 'dir' | 'file';

export class LocalWorkspace {
  readonly root: string;
  private readonly allowedRoots = new Map<string, AllowedRootKind>();

  constructor(root?: string) {
    const detectedRoot = root ?? LocalWorkspace.getDefaultRoot();
    this.root = fs.realpathSync(detectedRoot);
    this.allowedRoots.set(this.root, 'dir');
    for (const extraRoot of LocalWorkspace.getVsCodeWorkspaceRoots()) {
      try {
        this.allowedRoots.set(fs.realpathSync(extraRoot), 'dir');
      } catch {
        // Ignore invalid workspace roots.
      }
    }
  }

  static getDefaultRoot(): string {
    const vscodeRoots = LocalWorkspace.getVsCodeWorkspaceRoots();
    if (vscodeRoots.length > 0) return vscodeRoots[0];
    return process.cwd();
  }

  private static getVsCodeWorkspaceRoots(): string[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require('vscode') as typeof import('vscode');
      const folders = vscode.workspace?.workspaceFolders ?? [];
      return folders
        .map((folder) => (folder.uri?.scheme === 'file' ? folder.uri.fsPath : undefined))
        .filter((folder): folder is string => typeof folder === 'string' && folder.length > 0);
    } catch {
      return [];
    }
  }

  private normalizeExistingOrParent(candidate: string): string {
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
  }

  allowPath(targetPath: string): void {
    const candidate = path.resolve(targetPath);
    const normalized = this.normalizeExistingOrParent(candidate);
    const kind: AllowedRootKind = (() => {
      try {
        const stat = fs.statSync(normalized);
        return stat.isDirectory() ? 'dir' : 'file';
      } catch {
        return 'file';
      }
    })();
    this.allowedRoots.set(normalized, kind);
  }

  isPathAllowed(targetPath: string): boolean {
    try {
      void this.resolvePath(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  resolvePath(targetPath: string): string {
    const candidate = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.root, targetPath);
    const normalized = this.normalizeExistingOrParent(candidate);
    for (const [root, kind] of this.allowedRoots.entries()) {
      if (kind === 'file') {
        if (normalized === root) return normalized;
        continue;
      }
      const relative = path.relative(root, normalized);
      if (
        relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      ) {
        return normalized;
      }
    }
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  private getContainingDirRoot(resolvedPath: string): string | null {
    let best: string | null = null;
    for (const [root, kind] of this.allowedRoots.entries()) {
      if (kind !== 'dir') continue;
      const relative = path.relative(root, resolvedPath);
      if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        if (!best || root.length > best.length) best = root;
      }
    }
    return best;
  }

  private async ensureSafeDirectory(root: string, dirPath: string): Promise<void> {
    const relative = path.relative(root, dirPath);
    if (relative === '' || relative === '.') return;
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace root: ${dirPath}`);
    }

    const assertContained = (candidate: string) => {
      const candidateRel = path.relative(root, candidate);
      if (
        candidateRel.startsWith(`..${path.sep}`)
        || candidateRel === '..'
        || path.isAbsolute(candidateRel)
      ) {
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
  }

  private async revalidateDirectory(
    operation: string,
    verb: string,
    subject: string,
    directoryPath: string,
    absPath: string,
    expectedCanonicalDir: string,
    containingRoot: string | undefined,
    options: { requireDirectory: boolean; throwIfMissing: boolean; notDirectorySubject?: string },
  ): Promise<string> {
    let parentStat: fs.Stats;
    try {
      parentStat = await fs.promises.lstat(directoryPath);
    } catch (error) {
      if (options.throwIfMissing) {
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
    if (containingRoot) {
      const rel = path.relative(containingRoot, canonicalDir);
      if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: ${absPath}`);
      }
    }
    if (canonicalDir !== expectedCanonicalDir) {
      throw new Error(`${operation} failed: ${subject} changed during ${verb}: ${directoryPath}`);
    }

    return canonicalDir;
  }

  private async writeFileSafely(absPath: string, content: string | Buffer, containingRoot?: string): Promise<void> {
    const constants = fs.constants as Record<string, number>;
    const noFollow =
      os.platform() === 'win32'
        ? 0
        : typeof constants.O_NOFOLLOW === 'number'
          ? constants.O_NOFOLLOW
          : 0;

    let targetMode: number | undefined;
    try {
      const stat = await fs.promises.lstat(absPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`writeFile failed: refusing to write to symlink path: ${absPath}`);
      }
      targetMode = stat.mode;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        // ok: creating the file
      } else {
        throw error;
      }
    }

    const requestedDir = path.dirname(absPath);
    if (containingRoot) {
      await this.ensureSafeDirectory(containingRoot, requestedDir);
    }

    let parentStat: fs.Stats;
    try {
      parentStat = await fs.promises.lstat(requestedDir);
    } catch {
      throw new Error(`writeFile failed: parent directory does not exist: ${requestedDir}`);
    }

    if (parentStat.isSymbolicLink()) {
      throw new Error(`writeFile failed: refusing to write through symlink parent directory: ${requestedDir}`);
    }
    if (!parentStat.isDirectory()) {
      throw new Error(`writeFile failed: parent is not a directory: ${requestedDir}`);
    }

    const canonicalDir = await fs.promises.realpath(requestedDir);
    if (containingRoot) {
      const rel = path.relative(containingRoot, canonicalDir);
      if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
        throw new Error(`Path escapes workspace root: ${absPath}`);
      }
    }

    const base = path.basename(absPath);
    if (noFollow) {
      // `O_NOFOLLOW` only protects the final path component; re-validate the parent directory
      // immediately before opening so a late parent symlink swap can't redirect the write.
      const canonicalDirBeforeOpen = await this.revalidateDirectory(
        'writeFile',
        'write',
        'parent directory',
        requestedDir,
        absPath,
        canonicalDir,
        containingRoot,
        { requireDirectory: true, throwIfMissing: true },
      );

      const safeTargetPath = path.join(canonicalDirBeforeOpen, base);
      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow;
      const handle = await fs.promises.open(safeTargetPath, flags, targetMode ?? 0o666);
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      return;
    }

    const targetPath = path.join(canonicalDir, base);
    const tempFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;

    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const tempPath = path.join(canonicalDir, `.${base}.tmp-${suffix}`);

      let handle: fs.promises.FileHandle | undefined;
      try {
        handle = await fs.promises.open(tempPath, tempFlags, targetMode ?? 0o666);
        await handle.writeFile(content);
        await handle.close();
        handle = undefined;

        // Re-check parent just before renaming to avoid late symlink swaps.
        await this.revalidateDirectory('writeFile', 'write', 'parent directory', requestedDir, absPath, canonicalDir, containingRoot, {
          requireDirectory: false,
          throwIfMissing: false,
        });

        await fs.promises.rename(tempPath, targetPath);
        return;
      } catch (error) {
        if (handle) {
          try {
            await handle.close();
          } catch {
            // ignore
          }
        }
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // ignore
        }

        if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
          continue;
        }
        throw error;
      }
    }
    throw new Error(`writeFile failed: unable to create temp file in ${canonicalDir}`);
  }

  async readFile(targetPath: string, encoding: WorkspaceEncoding = 'utf8'): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    const parentDir = path.dirname(resolved);
    const root = this.getContainingDirRoot(parentDir) ?? undefined;

    let canonicalParentDir: string;
    try {
      canonicalParentDir = await fs.promises.realpath(parentDir);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        throw new Error(`readFile failed: parent directory does not exist: ${parentDir}`);
      }
      throw error;
    }

    const stableParentDir = await this.revalidateDirectory(
      'readFile',
      'read',
      'parent directory',
      parentDir,
      resolved,
      canonicalParentDir,
      root,
      { requireDirectory: true, throwIfMissing: true, notDirectorySubject: 'parent' },
    );

    const constants = fs.constants as Record<string, number>;
    const noFollow =
      os.platform() === 'win32'
        ? 0
        : typeof constants.O_NOFOLLOW === 'number'
          ? constants.O_NOFOLLOW
          : 0;

    const safeTargetPath = path.join(stableParentDir, path.basename(resolved));
    if (noFollow) {
      const handle = await fs.promises.open(safeTargetPath, constants.O_RDONLY | noFollow);
      try {
        const buf = await handle.readFile();
        return buf.toString(encoding);
      } finally {
        await handle.close();
      }
    }

    const stat = await fs.promises.lstat(safeTargetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`readFile failed: refusing to read symlink path: ${safeTargetPath}`);
    }
    return readFileAsync(safeTargetPath, encoding);
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    const parentDir = path.dirname(resolved);
    const root = this.getContainingDirRoot(parentDir);
    if (!root) {
      const kind = this.allowedRoots.get(resolved);
      if (kind === 'file') {
        let stat: fs.Stats;
        try {
          stat = await fs.promises.lstat(parentDir);
        } catch {
          throw new Error(`writeFile failed: parent directory does not exist: ${parentDir}`);
        }
        if (stat.isSymbolicLink()) {
          throw new Error(`writeFile failed: refusing to write through symlink parent directory: ${parentDir}`);
        }
        if (!stat.isDirectory()) {
          throw new Error(`writeFile failed: parent is not a directory: ${parentDir}`);
        }
        await this.writeFileSafely(resolved, content);
        return;
      }
      throw new Error(`writeFile failed: path is not contained in an allowlisted workspace root: ${targetPath}`);
    }

    await this.writeFileSafely(resolved, content, root);
  }

  async remove(targetPath: string): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    const parentDir = path.dirname(resolved);
    const root = this.getContainingDirRoot(parentDir) ?? undefined;
    if (!root) {
      const kind = this.allowedRoots.get(resolved);
      if (kind !== 'file') {
        throw new Error(`remove failed: path is not contained in an allowlisted workspace root: ${targetPath}`);
      }
    }

    let canonicalParentDir: string;
    try {
      canonicalParentDir = await fs.promises.realpath(parentDir);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const stableParentDir = await this.revalidateDirectory(
      'remove',
      'remove',
      'parent directory',
      parentDir,
      resolved,
      canonicalParentDir,
      root,
      { requireDirectory: true, throwIfMissing: false, notDirectorySubject: 'parent' },
    );

    const safeTargetPath = path.join(stableParentDir, path.basename(resolved));
    await rm(safeTargetPath, { force: true, recursive: true });
  }

  async list(targetPath = '.'): Promise<DirectoryEntry[]> {
    const resolved = this.resolvePath(targetPath);
    const root = this.getContainingDirRoot(resolved);
    if (!root) {
      throw new Error(`list failed: path is not contained in an allowlisted workspace root: ${targetPath}`);
    }

    const canonicalDir = await fs.promises.realpath(resolved);
    const stableDir = await this.revalidateDirectory(
      'list',
      'list',
      'directory',
      resolved,
      resolved,
      canonicalDir,
      root,
      { requireDirectory: true, throwIfMissing: true, notDirectorySubject: 'path' },
    );

    const entries = await readdir(stableDir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(targetPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));
  }

  async ensureDirectory(targetPath: string): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    const root = this.getContainingDirRoot(resolved);
    if (!root) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }

    await this.ensureSafeDirectory(root, resolved);
    const canonical = await fs.promises.realpath(resolved);
    const relative = path.relative(root, canonical);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }
    return resolved;
  }

  async runCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const cwd = options.cwd ? this.resolvePath(options.cwd) : this.root;
    return new Promise<CommandResult>((resolve) => {
      const env: EnvVars = { ...process.env };
      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          if (typeof value === 'string' || value === undefined) {
            env[key] = value;
          }
        }
      }
      const spawnOptions: SpawnOptions = {
        cwd,
        env,
        shell: options.shell ?? (os.platform() === 'win32' ? undefined : '/bin/bash'),
      };
      const child = spawn(command, spawnOptions);

      let stdout = '';
      let stderr = '';
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            if (os.platform() === 'win32') {
              // On Windows, best-effort kill the entire process tree.
              // `child.kill()` may only terminate the parent process, leaving payloads running.
              try {
                spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                  stdio: 'ignore',
                  windowsHide: true,
                });
              } catch {
                child.kill('SIGTERM');
              }
              return;
            }
            child.kill('SIGTERM');
          }, options.timeoutMs)
        : null;

      child.stdout?.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer | string) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve({
          command,
          cwd,
          stdout,
          stderr,
          exitCode: code ?? -1,
        });
      });
    });
  }

  async gitStatus(): Promise<CommandResult> {
    return this.runCommand('git status --porcelain', { cwd: this.root });
  }

  async gitDiff(paths?: string[]): Promise<CommandResult> {
    const sanitizedPaths = paths?.map((p) => this.resolvePath(p));
    const relativePaths = sanitizedPaths?.map((p) => path.relative(this.root, p));
    const command = relativePaths?.length
      ? `git diff HEAD -- ${relativePaths.map((p) => JSON.stringify(p)).join(' ')}`
      : 'git diff HEAD';
    return this.runCommand(command, { cwd: this.root });
  }
}

export default LocalWorkspace;
