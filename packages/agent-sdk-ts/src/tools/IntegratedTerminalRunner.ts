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

export class IntegratedTerminalRunner {
  private readonly vscodeApi: typeof import('vscode') | null;

  constructor(private readonly workspace: LocalWorkspace, vscodeModule: typeof import('vscode') | null = loadVscode()) {
    this.vscodeApi = vscodeModule;
  }

  async execute(command: string, cwd?: string, terminalName = 'OpenHands Agent'): Promise<CommandResult> {
    const workingDirectory = cwd ? this.workspace.resolvePath(cwd) : this.workspace.root;
    if (this.vscodeApi) {
      return this.runWithPseudoterminal(command, workingDirectory, terminalName);
    }
    return this.spawnDirect(command, workingDirectory);
  }

  private async runWithPseudoterminal(
    command: string,
    cwd: string,
    terminalName: string,
  ): Promise<CommandResult> {
    const vscode = this.vscodeApi!;
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<void>();

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

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
          exitCode = code ?? 0;
          closeEmitter.fire();
        });
      },
      close: () => {
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

  private spawnDirect(command: string, cwd: string): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, {
        cwd,
        env: process.env,
        shell: os.platform() === 'win32' ? undefined : '/bin/bash',
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          command,
          cwd,
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });
    });
  }
}
