import { spawn } from 'child_process';
import type { AgentServerWorkspace, ConversationWorkspacePayload } from './BaseWorkspace';
import { RemoteWorkspace } from './RemoteWorkspace';
import type {
  CommandOptions,
  CommandResult,
  DirectoryEntry,
  WorkspaceEncoding,
} from './types';

export interface AppleWorkspaceMount {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

export interface AppleWorkspaceOptions {
  root?: string;
  serverUrl?: string;
  hostPort?: number;
  serverPort?: number;
  serverImage?: string;
  startupCommand?: string[];
  volumes?: AppleWorkspaceMount[];
  forwardEnv?: string[];
  containerBinary?: string;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  httpTimeoutMs?: number;
  runtimeSessionApiKey?: string;
  cloudApiKey?: string;
  runtimeApiUrl?: string;
  runtimeApiKey?: string;
  runtimeId?: string;
}

const DEFAULT_ROOT = '/workspace';
const DEFAULT_SERVER_PORT = 8000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Apple Container-backed remote workspace.
 *
 * When `serverImage` is configured, this workspace owns the container lifecycle
 * for the nested runner surface. File and command operations are proxied through
 * the remote runtime once it becomes healthy. `pause()` and `resume()` still
 * require a dedicated runtime control surface in that managed-container mode
 * and will throw until that exists.
 */
export class AppleWorkspace implements AgentServerWorkspace {
  readonly kind = 'apple' as const;
  readonly root: string;

  private readonly remote: RemoteWorkspace;
  private readonly serverUrl: string;
  private readonly serverImage?: string;
  private readonly hostPort?: number;
  private readonly serverPort: number;
  private readonly startupCommand?: string[];
  private readonly volumes: AppleWorkspaceMount[];
  private readonly forwardEnv: string[];
  private readonly containerBinary: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;

  private process: ReturnType<typeof spawn> | null = null;
  private startupPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(options: AppleWorkspaceOptions) {
    this.root = isNonEmptyString(options.root) ? options.root.trim() : DEFAULT_ROOT;
    this.serverUrl = isNonEmptyString(options.serverUrl)
      ? options.serverUrl.trim().replace(/\/+$/, '')
      : `http://127.0.0.1:${AppleWorkspace.requireHostPort(options.hostPort)}`;
    this.serverImage = isNonEmptyString(options.serverImage) ? options.serverImage.trim() : undefined;
    this.hostPort = options.hostPort;
    this.serverPort = typeof options.serverPort === 'number' && Number.isFinite(options.serverPort)
      ? Math.max(1, Math.trunc(options.serverPort))
      : DEFAULT_SERVER_PORT;
    this.startupCommand = Array.isArray(options.startupCommand) && options.startupCommand.length > 0
      ? options.startupCommand
      : undefined;
    this.volumes = Array.isArray(options.volumes) ? options.volumes : [];
    this.forwardEnv = Array.isArray(options.forwardEnv) ? options.forwardEnv.filter(isNonEmptyString) : [];
    this.containerBinary = isNonEmptyString(options.containerBinary) ? options.containerBinary.trim() : 'container';
    this.startupTimeoutMs = typeof options.startupTimeoutMs === 'number' && Number.isFinite(options.startupTimeoutMs)
      ? Math.max(1, Math.trunc(options.startupTimeoutMs))
      : DEFAULT_STARTUP_TIMEOUT_MS;
    this.pollIntervalMs = typeof options.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)
      ? Math.max(0, Math.trunc(options.pollIntervalMs))
      : DEFAULT_POLL_INTERVAL_MS;

    this.remote = new RemoteWorkspace({
      host: this.serverUrl,
      cloudApiKey: options.cloudApiKey,
      runtimeSessionApiKey: options.runtimeSessionApiKey,
      workingDir: this.root,
      pollIntervalMs: options.pollIntervalMs,
      httpTimeoutMs: options.httpTimeoutMs,
      runtimeApiUrl: options.runtimeApiUrl,
      runtimeApiKey: options.runtimeApiKey,
      runtimeId: options.runtimeId,
    });
  }

  private static requireHostPort(hostPort: number | undefined): number {
    if (typeof hostPort !== 'number' || !Number.isFinite(hostPort)) {
      throw new Error('AppleWorkspace requires either serverUrl or hostPort');
    }
    return Math.max(1, Math.trunc(hostPort));
  }

  getServerUrl(): string {
    return this.remote.getServerUrl();
  }

  getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return this.remote.getAuthHeaders(extra);
  }

  getRuntimeSessionApiKey(): string {
    return this.remote.getRuntimeSessionApiKey();
  }

  getConversationWorkspacePayload(): ConversationWorkspacePayload {
    return this.remote.getConversationWorkspacePayload();
  }

  setAuth(params: { cloudApiKey?: string; runtimeSessionApiKey?: string }): void {
    this.remote.setAuth(params);
  }

  allowPath(targetPath: string): void {
    this.remote.allowPath(targetPath);
  }

  isPathAllowed(targetPath: string): boolean {
    return this.remote.isPathAllowed(targetPath);
  }

  resolvePath(targetPath: string): string {
    return this.remote.resolvePath(targetPath);
  }

  async readFile(targetPath: string, encoding?: WorkspaceEncoding): Promise<string> {
    await this.ensureStarted();
    return await this.remote.readFile(targetPath, encoding);
  }

  async readFileBytes(targetPath: string, options?: { maxBytes?: number }): Promise<Buffer> {
    await this.ensureStarted();
    return await this.remote.readFileBytes(targetPath, options);
  }

  async writeFile(targetPath: string, content: string | Buffer): Promise<void> {
    await this.ensureStarted();
    await this.remote.writeFile(targetPath, content);
  }

  async remove(targetPath: string): Promise<void> {
    await this.ensureStarted();
    await this.remote.remove(targetPath);
  }

  async list(targetPath?: string): Promise<DirectoryEntry[]> {
    await this.ensureStarted();
    return await this.remote.list(targetPath);
  }

  async ensureDirectory(targetPath: string): Promise<string> {
    await this.ensureStarted();
    return await this.remote.ensureDirectory(targetPath);
  }

  async runCommand(command: string, options?: CommandOptions): Promise<CommandResult> {
    await this.ensureStarted();
    return await this.remote.runCommand(command, options);
  }

  async gitStatus(): Promise<CommandResult> {
    await this.ensureStarted();
    return await this.remote.gitStatus();
  }

  async gitDiff(paths?: string[]): Promise<CommandResult> {
    await this.ensureStarted();
    return await this.remote.gitDiff(paths);
  }

  async isAlive(): Promise<boolean> {
    if (this.serverImage) {
      await this.ensureStarted();
    }
    return await this.remote.isAlive();
  }

  /**
   * Managed AppleWorkspace containers do not yet expose a runtime pause API.
   * Use an attached remote workspace until that control surface exists.
   */
  async pause(): Promise<void> {
    if (!this.serverImage) {
      await this.remote.pause();
      return;
    }
    throw new Error('AppleWorkspace.pause is not supported yet without a runtime API control surface');
  }

  /**
   * Managed AppleWorkspace containers do not yet expose a runtime resume API.
   * Use an attached remote workspace until that control surface exists.
   */
  async resume(): Promise<void> {
    if (!this.serverImage) {
      await this.remote.resume();
      return;
    }
    throw new Error('AppleWorkspace.resume is not supported yet without a runtime API control surface');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.process;
    this.process = null;
    this.startupPromise = null;
    if (!child) return;

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        child.off('close', onClose);
        child.off('error', onError);
        resolve();
      };
      const onClose = () => cleanup();
      const onError = () => cleanup();
      child.once('close', onClose);
      child.once('error', onError);
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore double-kill errors.
        }
        cleanup();
      }, 2_000).unref();
    });
  }

  private async ensureStarted(): Promise<void> {
    if (!this.serverImage) return;
    if (this.stopped) {
      throw new Error('AppleWorkspace was stopped and cannot be restarted');
    }
    if (!this.startupPromise) {
      this.startupPromise = this.startServer();
    }
    await this.startupPromise;
  }

  private buildContainerArgs(): string[] {
    if (!this.serverImage || !this.hostPort) {
      throw new Error('AppleWorkspace container startup requires serverImage + hostPort');
    }

    const args: string[] = [
      'run',
      '--rm',
      '-p',
      `${this.hostPort}:${this.serverPort}`,
    ];

    for (const mount of this.volumes) {
      if (mount.readonly) {
        args.push(
          '--mount',
          `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
        );
      } else {
        args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
      }
    }

    for (const key of this.forwardEnv) {
      const value = process.env[key];
      if (isNonEmptyString(value)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(this.serverImage);
    if (this.startupCommand) {
      args.push(...this.startupCommand);
    }

    return args;
  }

  private async startServer(): Promise<void> {
    const args = this.buildContainerArgs();
    const startupErrors: string[] = [];

    const child = spawn(this.containerBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;

    child.stderr.on('data', (chunk: Buffer | string) => {
      startupErrors.push(chunk.toString());
      if (startupErrors.length > 20) {
        startupErrors.shift();
      }
    });

    const childExitPromise = new Promise<never>((_, reject) => {
      child.once('error', (error) => {
        reject(error);
      });
      child.once('close', (code, signal) => {
        this.process = null;
        const exitInfo = signal ? `signal ${signal}` : `code ${String(code)}`;
        reject(new Error(`AppleWorkspace container exited before becoming healthy (${exitInfo})`));
      });
    });

    const waitForHealth = async (): Promise<void> => {
      const deadline = Date.now() + this.startupTimeoutMs;
      while (Date.now() < deadline) {
        if (await this.remote.isAlive()) {
          return;
        }
        await sleep(this.pollIntervalMs);
      }

      const details = startupErrors.join('').trim();
      throw new Error(
        details
          ? `AppleWorkspace startup timed out: ${details}`
          : 'AppleWorkspace startup timed out waiting for /health',
      );
    };

    try {
      await Promise.race([waitForHealth(), childExitPromise]);
    } catch (error) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore cleanup failures.
      }
      this.process = null;
      this.startupPromise = null;
      throw error;
    }
  }
}

export default AppleWorkspace;
