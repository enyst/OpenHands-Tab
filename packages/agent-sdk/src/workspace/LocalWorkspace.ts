import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';
import * as fs from 'fs';
import { readFile as readFileAsync, rm, readdir } from 'node:fs/promises';
import path from 'path';
import os from 'os';
import type { BaseWorkspace } from './BaseWorkspace';
import type { CommandOptions, CommandResult, DirectoryEntry, WorkspaceEncoding } from './types';
import {
  ensureSafeDirectory,
  normalizeExistingOrParent,
  revalidateDirectory,
} from './localWorkspacePathPolicy';

type EnvVars = Record<string, string | undefined>;

export class LocalWorkspace implements BaseWorkspace {
  readonly kind = 'local' as const;
  readonly root: string;

  constructor(root?: string) {
    const detectedRoot = root ?? LocalWorkspace.getDefaultRoot();
    this.root = fs.realpathSync(detectedRoot);
  }

  static getDefaultRoot(): string {
    const vscodeRoots = LocalWorkspace.getVsCodeWorkspaceRoots();
    if (vscodeRoots.length > 0) return vscodeRoots[0];
    return process.cwd();
  }

  private static getVsCodeWorkspaceRoots(): string[] {
    const vscode = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('vscode') as typeof import('vscode');
      } catch {
        // Unit tests (and some non-VS Code embeddings) may provide a minimal shim on globalThis.
        return (globalThis as unknown as { vscode?: { workspace?: { workspaceFolders?: unknown[] } } }).vscode;
      }
    })();

    const folders = vscode?.workspace?.workspaceFolders ?? [];
    return folders
      .map((folder) => {
        if (!folder || typeof folder !== 'object') return undefined;
        const uri = (folder as { uri?: { scheme?: unknown; fsPath?: unknown } }).uri;
        const scheme = typeof uri?.scheme === 'string' ? uri.scheme : '';
        const fsPath = typeof uri?.fsPath === 'string' ? uri.fsPath : '';
        if (!fsPath) return undefined;
        return (scheme === 'file' || scheme === 'vscode-remote') ? fsPath : undefined;
      })
      .filter((folder): folder is string => typeof folder === 'string' && folder.length > 0);
  }

  allowPath(targetPath: string): void {
    void targetPath;
  }

  isPathAllowed(targetPath: string): boolean {
    void targetPath;
    return true;
  }

  resolvePath(targetPath: string): string {
    const candidate = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.root, targetPath);
    return normalizeExistingOrParent(candidate);
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
    await ensureSafeDirectory(requestedDir);

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

    const base = path.basename(absPath);
    if (noFollow) {
      // `O_NOFOLLOW` only protects the final path component; re-validate the parent directory
      // immediately before opening so a late parent symlink swap can't redirect the write.
      const canonicalDirBeforeOpen = await revalidateDirectory({
        operation: 'writeFile',
        verb: 'write',
        subject: 'parent directory',
        directoryPath: requestedDir,
        absPath,
        expectedCanonicalDir: canonicalDir,
        containingRoot,
        options: { requireDirectory: true, throwIfMissing: true },
      });

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
        await revalidateDirectory({
          operation: 'writeFile',
          verb: 'write',
          subject: 'parent directory',
          directoryPath: requestedDir,
          absPath,
          expectedCanonicalDir: canonicalDir,
          containingRoot,
          options: {
            requireDirectory: false,
            throwIfMissing: false,
          },
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

    let canonicalParentDir: string;
    try {
      canonicalParentDir = await fs.promises.realpath(parentDir);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        throw new Error(`readFile failed: parent directory does not exist: ${parentDir}`);
      }
      throw error;
    }

    const stableParentDir = await revalidateDirectory({
      operation: 'readFile',
      verb: 'read',
      subject: 'parent directory',
      directoryPath: parentDir,
      absPath: resolved,
      expectedCanonicalDir: canonicalParentDir,
      options: { requireDirectory: true, throwIfMissing: true, notDirectorySubject: 'parent' },
    });

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

  async readFileBytes(targetPath: string, options: { maxBytes?: number } = {}): Promise<Buffer> {
    const resolved = this.resolvePath(targetPath);
    const parentDir = path.dirname(resolved);

    let canonicalParentDir: string;
    try {
      canonicalParentDir = await fs.promises.realpath(parentDir);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        throw new Error(`readFileBytes failed: parent directory does not exist: ${parentDir}`);
      }
      throw error;
    }

    const stableParentDir = await revalidateDirectory({
      operation: 'readFileBytes',
      verb: 'read',
      subject: 'parent directory',
      directoryPath: parentDir,
      absPath: resolved,
      expectedCanonicalDir: canonicalParentDir,
      options: { requireDirectory: true, throwIfMissing: true, notDirectorySubject: 'parent' },
    });

    const constants = fs.constants as Record<string, number>;
    const noFollow =
      os.platform() === 'win32'
        ? 0
        : typeof constants.O_NOFOLLOW === 'number'
          ? constants.O_NOFOLLOW
          : 0;

    const safeTargetPath = path.join(stableParentDir, path.basename(resolved));
    const maxBytes = options.maxBytes;

    const formatTooLargeError = (sizeBytes: number): Error => {
      const mb = sizeBytes / 1024 / 1024;
      const maxMb = typeof maxBytes === 'number' ? maxBytes / 1024 / 1024 : 0;
      const maxLabel = Number.isInteger(maxMb) ? String(maxMb) : maxMb.toFixed(1);
      return new Error(`File is too large (${mb.toFixed(1)}MB). Maximum allowed size is ${maxLabel}MB.`);
    };

    if (noFollow) {
      const handle = await fs.promises.open(safeTargetPath, constants.O_RDONLY | noFollow);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) {
          throw new Error(`readFileBytes failed: path is not a file: ${safeTargetPath}`);
        }
        if (typeof maxBytes === 'number' && stat.size > maxBytes) {
          throw formatTooLargeError(stat.size);
        }
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    }

    const stat = await fs.promises.lstat(safeTargetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`readFileBytes failed: refusing to read symlink path: ${safeTargetPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`readFileBytes failed: path is not a file: ${safeTargetPath}`);
    }
    if (typeof maxBytes === 'number' && stat.size > maxBytes) {
      throw formatTooLargeError(stat.size);
    }
    return readFileAsync(safeTargetPath);
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    await this.writeFileSafely(resolved, content);
  }

  async remove(targetPath: string): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    const parentDir = path.dirname(resolved);

    let canonicalParentDir: string;
    try {
      canonicalParentDir = await fs.promises.realpath(parentDir);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const stableParentDir = await revalidateDirectory({
      operation: 'remove',
      verb: 'remove',
      subject: 'parent directory',
      directoryPath: parentDir,
      absPath: resolved,
      expectedCanonicalDir: canonicalParentDir,
      options: { requireDirectory: true, throwIfMissing: false, notDirectorySubject: 'parent' },
    });

    const safeTargetPath = path.join(stableParentDir, path.basename(resolved));
    await rm(safeTargetPath, { force: true, recursive: true });
  }

  async list(targetPath = '.'): Promise<DirectoryEntry[]> {
    const resolved = this.resolvePath(targetPath);

    const canonicalDir = await fs.promises.realpath(resolved);
    const stableDir = await revalidateDirectory({
      operation: 'list',
      verb: 'list',
      subject: 'directory',
      directoryPath: resolved,
      absPath: resolved,
      expectedCanonicalDir: canonicalDir,
      options: { requireDirectory: true, throwIfMissing: true, notDirectorySubject: 'path' },
    });

    const entries = await readdir(stableDir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(targetPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));
  }

  async ensureDirectory(targetPath: string): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    await ensureSafeDirectory(resolved);
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


  isAlive(): Promise<boolean> {
    return Promise.resolve(true);
  }

  pause(): Promise<void> {
    return Promise.resolve();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

}

export default LocalWorkspace;
