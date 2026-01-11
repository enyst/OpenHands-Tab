import fs from 'fs';
import { mkdir as mkdirAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import path from 'node:path';
import type { BaseWorkspace } from './BaseWorkspace';
import type {
  CommandOptions,
  CommandResult,
  DirectoryEntry,
  FileOperationResult,
  GitChange,
  WorkspaceEncoding,
} from './types';

const normalizeRemoteHostUrl = (raw: string): string => {
  let url = raw.trim();
  if (!url) return url;

  if (url.startsWith('ws://')) url = `http://${url.slice('ws://'.length)}`;
  else if (url.startsWith('wss://')) url = `https://${url.slice('wss://'.length)}`;
  else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = `http://${url}`;

  return url.replace(/\/+$/, '');
};

const normalizePosixRoot = (raw: string): string => {
  const normalized = path.posix.normalize(raw.trim() || '/');
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
};

const encodePathForUrl = (absolutePath: string): string =>
  absolutePath
    .split('/')
    .map((segment, idx) => (idx === 0 ? segment : encodeURIComponent(segment)))
    .join('/');

type NodeBufferEncoding = Parameters<Buffer['toString']>[0];

const normalizeEncoding = (encoding: WorkspaceEncoding): NodeBufferEncoding => {
  if (encoding === 'utf-8') return 'utf8';
  if (encoding === 'ucs-2') return 'ucs2';
  return encoding as NodeBufferEncoding;
};

export interface RemoteWorkspaceOptions {
  host: string;
  apiKey?: string;
  workingDir?: string;
  pollIntervalMs?: number;
  httpTimeoutMs?: number;
}

interface StartBashCommandResponse {
  id?: string;
}

interface BashEventsPage {
  items?: unknown[];
  next_page_id?: string | null;
}

type BashOutputItem = {
  kind: 'BashOutput';
  stdout?: string | null;
  stderr?: string | null;
  exit_code?: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBashOutputItem = (value: unknown): value is BashOutputItem => {
  if (!isRecord(value)) return false;
  if (value.kind !== 'BashOutput') return false;

  const stdout = value.stdout;
  if (stdout !== undefined && stdout !== null && typeof stdout !== 'string') return false;

  const stderr = value.stderr;
  if (stderr !== undefined && stderr !== null && typeof stderr !== 'string') return false;

  const exitCode = value.exit_code;
  if (exitCode !== undefined && exitCode !== null && typeof exitCode !== 'number') return false;

  return true;
};

export class RemoteWorkspace implements BaseWorkspace {
  readonly kind = 'remote' as const;
  readonly root: string;

  private readonly host: string;
  private readonly apiKey?: string;
  private readonly pollIntervalMs: number;
  private readonly httpTimeoutMs: number;

  private readonly allowedRoots = new Set<string>();

  constructor(options: RemoteWorkspaceOptions) {
    this.host = normalizeRemoteHostUrl(options.host);
    this.apiKey = typeof options.apiKey === 'string' && options.apiKey.trim() ? options.apiKey.trim() : undefined;
    this.root = normalizePosixRoot(options.workingDir ?? '/workspace');
    this.pollIntervalMs = typeof options.pollIntervalMs === 'number' ? Math.max(0, options.pollIntervalMs) : 100;
    this.httpTimeoutMs = typeof options.httpTimeoutMs === 'number' ? Math.max(0, options.httpTimeoutMs) : 60_000;
    this.allowedRoots.add(this.root);
  }

  allowPath(targetPath: string): void {
    const normalized = normalizePosixRoot(targetPath);
    if (!normalized.startsWith('/')) {
      throw new Error(`RemoteWorkspace.allowPath requires an absolute path, got: ${targetPath}`);
    }
    this.allowedRoots.add(normalized);
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
    const trimmed = targetPath.trim();
    if (!trimmed || trimmed === '.') return this.root;

    const candidate = trimmed.startsWith('/')
      ? path.posix.normalize(trimmed)
      : path.posix.normalize(path.posix.join(this.root, trimmed));

    for (const root of this.allowedRoots) {
      if (candidate === root) return candidate;
      if (root !== '/' && candidate.startsWith(`${root}/`)) return candidate;
      if (root === '/' && candidate.startsWith('/')) return candidate;
    }

    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  async readFile(targetPath: string, encoding: WorkspaceEncoding = 'utf8'): Promise<string> {
    const buf = await this.readFileBytes(targetPath);
    return buf.toString(normalizeEncoding(encoding));
  }

  async readFileBytes(targetPath: string, options: { maxBytes?: number } = {}): Promise<Buffer> {
    const absolutePath = this.resolvePath(targetPath);
    const encoded = encodePathForUrl(absolutePath);
    const url = `${this.host}/api/file/download//${encoded.startsWith('/') ? encoded.slice(1) : encoded}`;

    const res = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    }, this.httpTimeoutMs);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`RemoteWorkspace.readFileBytes failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (typeof options.maxBytes === 'number' && options.maxBytes >= 0 && buf.length > options.maxBytes) {
      throw new Error(`File is too large (${buf.length} bytes). Maximum allowed size is ${options.maxBytes} bytes.`);
    }
    return buf;
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    const absolutePath = this.resolvePath(targetPath);
    await this.uploadBytes(absolutePath, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
  }

  async remove(targetPath: string): Promise<void> {
    const absolutePath = this.resolvePath(targetPath);
    const result = await this.runCommand(`rm -rf -- ${JSON.stringify(absolutePath)}`);
    if (result.exitCode !== 0) {
      throw new Error(`RemoteWorkspace.remove failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }

  async list(targetPath = '.'): Promise<DirectoryEntry[]> {
    const absolutePath = this.resolvePath(targetPath);
    const result = await this.runCommand(`ls -1p -- ${JSON.stringify(absolutePath)}`);
    if (result.exitCode !== 0) {
      throw new Error(`RemoteWorkspace.list failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    const base = targetPath.trim() || '.';
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => {
        const isDirectory = name.endsWith('/');
        const trimmed = isDirectory ? name.slice(0, -1) : name;
        return {
          name: trimmed,
          path: path.posix.join(base, trimmed),
          isDirectory,
        };
      });
  }

  async ensureDirectory(targetPath: string): Promise<string> {
    const absolutePath = this.resolvePath(targetPath);
    const result = await this.runCommand(`mkdir -p -- ${JSON.stringify(absolutePath)}`);
    if (result.exitCode !== 0) {
      throw new Error(`RemoteWorkspace.ensureDirectory failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return absolutePath;
  }

  async copyToWorkspace(sourcePath: string, destinationPath: string): Promise<FileOperationResult> {
    return this.fileUpload(sourcePath, destinationPath);
  }

  async fileUpload(localPath: string, workspacePath: string): Promise<FileOperationResult> {
    try {
      const stat = await fs.promises.stat(localPath);
      if (!stat.isFile()) {
        return { success: false, path: workspacePath, error: `Source is not a file: ${localPath}` };
      }
      const bytes = await fs.promises.readFile(localPath);
      const absolutePath = this.resolvePath(workspacePath);
      await this.uploadBytes(absolutePath, bytes);
      return { success: true, path: workspacePath };
    } catch (error) {
      return { success: false, path: workspacePath, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async fileDownload(workspacePath: string, localPath: string): Promise<FileOperationResult> {
    try {
      const buf = await this.readFileBytes(workspacePath);
      await mkdirAsync(path.dirname(localPath), { recursive: true });
      await writeFileAsync(localPath, buf);
      return { success: true, path: localPath };
    } catch (error) {
      return { success: false, path: localPath, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async gitChanges(paths?: string[]): Promise<GitChange[]> {
    const sanitizedPaths = paths?.map((p) => this.resolvePath(p));
    const relativePaths = sanitizedPaths?.map((p) => path.posix.relative(this.root, p));
    const command = relativePaths?.length
      ? `git status --porcelain -- ${relativePaths.map((p) => JSON.stringify(p)).join(' ')}`
      : 'git status --porcelain';

    const result = await this.runCommand(command, { cwd: this.root });
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(`gitChanges failed (exit code ${result.exitCode})${detail ? `: ${detail}` : ''}`);
    }

    const lines = result.stdout.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
    const changes: GitChange[] = [];

    for (const line of lines) {
      const prefix = line.slice(0, 2);
      const rest = line.slice(2).trim();

      if (prefix === '??') {
        changes.push({ path: rest, status: 'untracked' });
        continue;
      }

      const statusChars = prefix.replaceAll(' ', '');
      const status = (() => {
        if (statusChars.includes('R')) return 'renamed' as const;
        if (statusChars.includes('A')) return 'added' as const;
        if (statusChars.includes('D')) return 'deleted' as const;
        if (statusChars.includes('M')) return 'modified' as const;
        return 'unknown' as const;
      })();

      if (status === 'renamed' && rest.includes('->')) {
        const [prevRaw, nextRaw] = rest.split('->').map((part) => part.trim());
        if (nextRaw) {
          changes.push({ path: nextRaw, previousPath: prevRaw || undefined, status });
          continue;
        }
      }

      changes.push({ path: rest, status });
    }

    return changes;
  }

  async runCommand(command: string, options: CommandOptions = {}): Promise<CommandResult> {
    const cwd = options.cwd ? this.resolvePath(options.cwd) : this.root;
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : 30_000;
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

    try {
      const res = await this.fetchWithTimeout(`${this.host}/api/bash/start_bash_command`, {
        method: 'POST',
        headers: this.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ command, cwd, timeout: timeoutSeconds }),
      }, timeoutMs + 5_000);

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`start_bash_command failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
      }

      const json = await res.json() as StartBashCommandResponse;
      const commandId = json.id;
      if (!commandId) {
        throw new Error('start_bash_command response missing id');
      }

      const stdoutParts: string[] = [];
      const stderrParts: string[] = [];
      let exitCode: number | null = null;

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const params = new URLSearchParams({
          command_id__eq: commandId,
          sort_order: 'TIMESTAMP',
          limit: '100',
        });

        const eventsRes = await this.fetchWithTimeout(
          `${this.host}/api/bash/bash_events/search?${params.toString()}`,
          { method: 'GET', headers: this.getAuthHeaders() },
          this.httpTimeoutMs,
        );

        if (!eventsRes.ok) {
          const detail = await eventsRes.text().catch(() => '');
          throw new Error(`bash_events/search failed (HTTP ${eventsRes.status})${detail ? `: ${detail}` : ''}`);
        }

        const page = await eventsRes.json() as BashEventsPage;
        const items = Array.isArray(page.items) ? page.items : [];
        for (const item of items) {
          if (!isBashOutputItem(item)) continue;
          if (typeof item.stdout === 'string') stdoutParts.push(item.stdout);
          if (typeof item.stderr === 'string') stderrParts.push(item.stderr);
          if (typeof item.exit_code === 'number') exitCode = item.exit_code;
        }

        if (exitCode !== null) break;
        if (this.pollIntervalMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      }

      if (exitCode === null) {
        exitCode = -1;
        stderrParts.push(`Command timed out after ${timeoutSeconds} seconds`);
      }

      return {
        command,
        cwd,
        stdout: stdoutParts.join(''),
        stderr: stderrParts.join(''),
        exitCode,
        timeoutOccurred: exitCode === -1,
      };
    } catch (error) {
      return {
        command,
        cwd,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        timeoutOccurred: false,
      };
    }
  }

  async gitStatus(): Promise<CommandResult> {
    return this.runCommand('git status --porcelain', { cwd: this.root });
  }

  async gitDiff(paths?: string[]): Promise<CommandResult> {
    const sanitizedPaths = paths?.map((p) => this.resolvePath(p));
    const relativePaths = sanitizedPaths?.map((p) => path.posix.relative(this.root, p));
    const cmd = relativePaths?.length
      ? `git diff HEAD -- ${relativePaths.map((p) => JSON.stringify(p)).join(' ')}`
      : 'git diff HEAD';
    return this.runCommand(cmd, { cwd: this.root });
  }

  private async uploadBytes(absoluteDestinationPath: string, bytes: Buffer): Promise<void> {
    const encodedPath = encodePathForUrl(absoluteDestinationPath);
    const url = `${this.host}/api/file/upload/${encodedPath}`;

    const form = new FormData();
    form.append('file', new Blob([bytes]), path.posix.basename(absoluteDestinationPath));

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: form,
    }, this.httpTimeoutMs);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Remote upload failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
    }
  }

  private getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.apiKey) headers['X-Session-API-Key'] = this.apiKey;
    return headers;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export default RemoteWorkspace;
