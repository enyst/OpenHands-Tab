import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
      const vscode = require('vscode') as typeof import('vscode');
      const folder = vscode.workspace?.workspaceFolders?.[0];
      if (folder?.uri?.scheme === 'file') {
        return folder.uri.fsPath;
      }
    } catch (err) {
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

  async readFile(targetPath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    return fs.promises.readFile(resolved, { encoding });
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, content);
  }

  async remove(targetPath: string): Promise<void> {
    const resolved = this.resolvePath(targetPath);
    await fs.promises.rm(resolved, { force: true, recursive: true });
  }

  async list(targetPath = '.'): Promise<DirectoryEntry[]> {
    const resolved = this.resolvePath(targetPath);
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(targetPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));
  }

  async ensureDirectory(targetPath: string): Promise<string> {
    const resolved = this.resolvePath(targetPath);
    await fs.promises.mkdir(resolved, { recursive: true });
    return resolved;
  }

  async runCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const cwd = options.cwd ? this.resolvePath(options.cwd) : this.root;
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, {
        cwd,
        env: { ...process.env, ...options.env },
        shell: options.shell ?? (os.platform() === 'win32' ? undefined : '/bin/bash'),
      });

      let stdout = '';
      let stderr = '';
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            child.kill('SIGTERM');
          }, options.timeoutMs)
        : null;

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
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
      ? `git diff HEAD -- ${relativePaths.map((p) => `'${p}'`).join(' ')}`
      : 'git diff HEAD';
    return this.runCommand(command, { cwd: this.root });
  }
}

export default LocalWorkspace;
