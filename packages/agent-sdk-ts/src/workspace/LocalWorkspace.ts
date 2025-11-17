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

export class LocalWorkspace {
  readonly root: string;

  constructor(root?: string) {
    const detectedRoot = root ?? LocalWorkspace.getDefaultRoot();
    this.root = fs.realpathSync(detectedRoot);
  }

  static getDefaultRoot(): string {
    const vscodeRoot = LocalWorkspace.getVsCodeWorkspaceRoot();
    if (vscodeRoot) {
      return vscodeRoot;
    }
    return process.cwd();
  }

  private static getVsCodeWorkspaceRoot(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require('vscode') as typeof import('vscode');
      const folder = vscode.workspace?.workspaceFolders?.[0];
      if (folder?.uri?.scheme === 'file') {
        return folder.uri.fsPath;
      }
    } catch {
      return null;
    }
    return null;
  }

  resolvePath(targetPath: string): string {
    const candidate = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.root, targetPath);
    const normalized = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
    const relative = path.relative(this.root, normalized);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return normalized;
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
