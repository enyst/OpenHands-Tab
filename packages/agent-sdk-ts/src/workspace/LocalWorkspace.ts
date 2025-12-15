import { spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';
import * as fs from 'fs';
import { readFile as readFileAsync, mkdir, writeFile as writeFileAsync, rm, readdir } from 'node:fs/promises';
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
  shell?: string;
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
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    try {
      const parent = path.dirname(candidate);
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        return path.join(realParent, path.basename(candidate));
      }
    } catch {
      // Best-effort normalization only.
    }
    return candidate;
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
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        return normalized;
      }
    }
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  async readFile(targetPath: string, encoding: WorkspaceEncoding = 'utf8'): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    return readFileAsync(resolved, encoding);
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFileAsync(resolved, content);
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
    await mkdir(resolved, { recursive: true });
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
