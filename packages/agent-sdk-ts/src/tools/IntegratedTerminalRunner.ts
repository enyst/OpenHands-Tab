import { spawn } from 'child_process';
import os from 'os';
import type { Pseudoterminal } from 'vscode';
import type { CommandResult } from '../workspace/types';
import type { LocalWorkspace } from '../workspace/LocalWorkspace';

const loadVscode = (): typeof import('vscode') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('vscode') as typeof import('vscode');
  } catch {
    return null;
  }
};

export interface TerminalRunOptions {
  cwd?: string;
  timeoutMs?: number;
  terminalName?: string;
  signal?: AbortSignal;
}

export class IntegratedTerminalRunner {
  private readonly vscodeApi: typeof import('vscode') | null;

  constructor(private readonly workspace: LocalWorkspace, vscodeModule: typeof import('vscode') | null = loadVscode()) {
    this.vscodeApi = vscodeModule;
  }

  async execute(command: string, options: TerminalRunOptions = {}): Promise<CommandResult> {
    const workingDirectory = options.cwd ? this.workspace.resolvePath(options.cwd) : this.workspace.root;
    const terminalName = options.terminalName ?? 'OpenHands Agent';
    if (this.vscodeApi) {
      return this.runWithPseudoterminal(command, workingDirectory, terminalName, options);
    }
    return this.spawnDirect(command, workingDirectory, options);
  }

  private async runWithPseudoterminal(
    command: string,
    cwd: string,
    terminalName: string,
    options: TerminalRunOptions,
  ): Promise<CommandResult> {
    const vscode = this.vscodeApi!;
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<void>();

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let aborted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options.timeoutMs;

    let childProcess: ReturnType<typeof spawn> | null = null;
    const abortHandler = () => {
      aborted = true;
      childProcess?.kill('SIGTERM');
    };

    const pty: Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {
        childProcess = spawn(command, {
          cwd,
          env: process.env,
          shell: os.platform() === 'win32' ? undefined : '/bin/bash',
        });

        if (timeoutMs && timeoutMs > 0) {
          timeout = setTimeout(() => {
            timedOut = true;
            childProcess?.kill('SIGTERM');
          }, timeoutMs);
        }

        if (options.signal) {
          if (options.signal.aborted) {
            abortHandler();
          }
          options.signal.addEventListener('abort', abortHandler);
        }

        childProcess.stdout?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          stdout += chunk;
          writeEmitter.fire(chunk);
        });

        childProcess.stderr?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          stderr += chunk;
          writeEmitter.fire(chunk);
        });

        childProcess.on('close', (code) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          if (options.signal) {
            options.signal.removeEventListener('abort', abortHandler);
          }
          const cancelled = timedOut || aborted;
          exitCode = cancelled ? code ?? -1 : code ?? 0;
          closeEmitter.fire();
        });
      },
      close: () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (options.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }
        childProcess?.kill();
        closeEmitter.fire();
      },
    };

    const terminal = vscode.window.createTerminal({ name: terminalName, pty });
    terminal.show(true);

    return new Promise<CommandResult>((resolve) => {
      closeEmitter.event(() => {
        resolve({
          command,
          cwd,
          stdout,
          stderr,
          exitCode,
          timeoutOccurred: timedOut,
        });
      });
    });
  }

  private spawnDirect(command: string, cwd: string, options: TerminalRunOptions): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, {
        cwd,
        env: process.env,
        shell: os.platform() === 'win32' ? undefined : '/bin/bash',
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, options.timeoutMs)
        : null;

      const abortHandler = () => {
        aborted = true;
        child.kill('SIGTERM');
      };

      if (options.signal) {
        if (options.signal.aborted) {
          abortHandler();
        }
        options.signal.addEventListener('abort', abortHandler);
      }

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
        if (options.signal) {
          options.signal.removeEventListener('abort', abortHandler);
        }
        resolve({
          command,
          cwd,
          stdout,
          stderr,
          exitCode: timedOut || aborted ? code ?? -1 : code ?? 0,
          timeoutOccurred: timedOut,
        });
      });
    });
  }
}
