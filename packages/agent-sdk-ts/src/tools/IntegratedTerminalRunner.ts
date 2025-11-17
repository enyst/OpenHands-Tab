import { spawn } from 'child_process';
import os from 'os';
import type { Pseudoterminal } from 'vscode';
import type { CommandResult } from '../workspace/LocalWorkspace';
import type { LocalWorkspace } from '../workspace/LocalWorkspace';

const loadVscode = (): typeof import('vscode') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    return require('vscode') as typeof import('vscode');
  } catch (err) {
    return null;
  }
};

export interface TerminalRunOptions {
  cwd?: string;
  timeoutMs?: number;
  terminalName?: string;
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
      return this.runWithPseudoterminal(command, workingDirectory, terminalName, options.timeoutMs);
    }
    return this.spawnDirect(command, workingDirectory, options.timeoutMs);
  }

  private async runWithPseudoterminal(
    command: string,
    cwd: string,
    terminalName: string,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    const vscode = this.vscodeApi!;
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<void>();

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    let childProcess: ReturnType<typeof spawn> | null = null;

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

        childProcess.stdout?.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          writeEmitter.fire(chunk);
        });

        childProcess.stderr?.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          writeEmitter.fire(chunk);
        });

        childProcess.on('close', (code) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          exitCode = timedOut ? code ?? -1 : code ?? 0;
          closeEmitter.fire();
        });
      },
      close: () => {
        if (timeout) {
          clearTimeout(timeout);
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
        });
      });
    });
  }

  private spawnDirect(command: string, cwd: string, timeoutMs?: number): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, {
        cwd,
        env: process.env,
        shell: os.platform() === 'win32' ? undefined : '/bin/bash',
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeout = timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, timeoutMs)
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
          exitCode: timedOut ? code ?? -1 : code ?? 0,
        });
      });
    });
  }
}
