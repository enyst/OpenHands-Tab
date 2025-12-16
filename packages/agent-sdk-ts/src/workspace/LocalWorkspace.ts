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

    const parts = relative.split(path.sep).filter((part) => part.length > 0);
    let current = root;

    for (const part of parts) {
      let currentStat: fs.Stats;
      try {
        currentStat = await fs.promises.lstat(current);
      } catch {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }

      if (currentStat.isSymbolicLink()) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }
      if (!currentStat.isDirectory()) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }

      current = await fs.promises.realpath(current);
      const currentRel = path.relative(root, current);
      if (currentRel.startsWith(`..${path.sep}`) || currentRel === '..' || path.isAbsolute(currentRel)) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }
      const next = path.join(current, part);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.lstat(next);
      } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
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
        const resolvedRel = path.relative(root, resolved);
        if (
          resolvedRel.startsWith(`..${path.sep}`)
          || resolvedRel === '..'
          || path.isAbsolute(resolvedRel)
        ) {
          throw new Error(`Path escapes workspace root: ${dirPath}`);
        }
        current = resolved;
        continue;
      }

      if (!stat.isDirectory()) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }
      current = await fs.promises.realpath(next);
      const nextRel = path.relative(root, current);
      if (nextRel.startsWith(`..${path.sep}`) || nextRel === '..' || path.isAbsolute(nextRel)) {
        throw new Error(`Path escapes workspace root: ${dirPath}`);
      }
    }
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

    const safeTargetPath = path.join(canonicalDir, path.basename(absPath));
    if (noFollow) {
      // `O_NOFOLLOW` only protects the final path component; re-validate the parent directory
      // immediately before opening so a late parent symlink swap can't redirect the write.
      let parentStatBeforeOpen: fs.Stats;
      try {
        parentStatBeforeOpen = await fs.promises.lstat(canonicalDir);
      } catch {
        throw new Error(`writeFile failed: parent directory does not exist: ${requestedDir}`);
      }
      if (parentStatBeforeOpen.isSymbolicLink()) {
        throw new Error(`writeFile failed: refusing to write through symlink parent directory: ${requestedDir}`);
      }
      if (!parentStatBeforeOpen.isDirectory()) {
        throw new Error(`writeFile failed: parent is not a directory: ${requestedDir}`);
      }
      const canonicalDirBeforeOpen = await fs.promises.realpath(canonicalDir);
      if (canonicalDirBeforeOpen !== canonicalDir) {
        throw new Error(`writeFile failed: parent directory changed during write: ${requestedDir}`);
      }
      if (containingRoot) {
        const relBeforeOpen = path.relative(containingRoot, canonicalDirBeforeOpen);
        if (relBeforeOpen.startsWith(`..${path.sep}`) || relBeforeOpen === '..' || path.isAbsolute(relBeforeOpen)) {
          throw new Error(`Path escapes workspace root: ${absPath}`);
        }
      }

      const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow;
      const handle = await fs.promises.open(safeTargetPath, flags, targetMode ?? 0o666);
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
      return;
    }

    const base = path.basename(absPath);
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
        const parentStatBeforeRename = await fs.promises.lstat(requestedDir);
        if (parentStatBeforeRename.isSymbolicLink()) {
          throw new Error(`writeFile failed: refusing to write through symlink parent directory: ${requestedDir}`);
        }

        const canonicalDirBeforeRename = await fs.promises.realpath(requestedDir);
        if (containingRoot) {
          const relBeforeRename = path.relative(containingRoot, canonicalDirBeforeRename);
          if (
            relBeforeRename.startsWith(`..${path.sep}`)
            || relBeforeRename === '..'
            || path.isAbsolute(relBeforeRename)
          ) {
            throw new Error(`Path escapes workspace root: ${absPath}`);
          }
        }
        if (canonicalDirBeforeRename !== canonicalDir) {
          throw new Error(`writeFile failed: parent directory changed during write: ${requestedDir}`);
        }

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
    return readFileAsync(resolved, encoding);
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

    await this.ensureSafeDirectory(root, parentDir);
    const canonicalParent = await fs.promises.realpath(parentDir);
    const relative = path.relative(root, canonicalParent);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }

    const safeResolved = path.join(canonicalParent, path.basename(resolved));
    await this.writeFileSafely(safeResolved, content, root);
  }

  async remove(targetPath: string): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    await rm(resolved, { force: true, recursive: true });
  }

  async list(targetPath = '.'): Promise<DirectoryEntry[]> {
    const resolved = this.resolvePath(targetPath);
    const entries = await readdir(resolved, { withFileTypes: true });
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
              // If we spawned through a shell, best-effort kill the entire process tree.
              // `child.kill()` may only terminate the shell process, leaving payloads running.
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
