import type { ChildProcessWithoutNullStreams } from 'child_process';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import os from 'os';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export interface TerminalArgs {
  command: string;
  is_input?: boolean;
  timeout?: number | null; // seconds
  reset?: boolean;
}

export interface TerminalResult {
  command?: string | null;
  exit_code?: number | null;
  // Back-compat for older consumers (e.g. BashEvent adapters).
  exitCode?: number | null;
  timeout?: boolean;
  stdout?: string;
  stderr?: string;
  previous?: {
    command: string;
    exit_code: number | null;
    // Back-compat for older consumers (e.g. BashEvent adapters).
    exitCode: number | null;
    stdout: string;
    stderr: string;
  };
}

const DEFAULT_NO_CHANGE_TIMEOUT_SECONDS = 60;

type SupportedSignal = 'SIGTERM' | 'SIGINT' | 'SIGTSTP';

type RunningTerminalProcess = {
  id: string;
  command: string;
  process: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  stdoutOffset: number;
  stderrOffset: number;
  lastActivityTs: number;
  exitCode: number | null;
  done: boolean;
  meta: {
    begin: string;
    end: string;
    exit: string;
    pwd: string;
    env: string;
  };
  waiters: Set<() => void>;
};

class TerminalSession {
  private cwd: string;
  private env: Record<string, string> = {};
  private running: RunningTerminalProcess | null = null;

  constructor(workDir: string) {
    this.cwd = workDir;
    this.initializeEnv();
  }

  async reset(workDir: string): Promise<void> {
    await this.killRunning('SIGTERM');
    this.cwd = workDir;
    this.initializeEnv();
  }

  private initializeEnv(): void {
    this.env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  async injectSecretsFromCommand(
    command: string,
    secrets: { getRegisteredNames: () => string[]; get: (name: string) => Promise<string | undefined> },
  ): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;
    const names = secrets.getRegisteredNames();
    if (!names.length) return;

    const lower = trimmed.toLowerCase();
    const updates: Record<string, string> = {};

    for (const name of names) {
      const candidate = typeof name === 'string' ? name.trim() : '';
      if (!candidate) continue;
      if (!lower.includes(candidate.toLowerCase())) continue;
      const value = await secrets.get(candidate);
      if (!value) continue;
      updates[candidate] = value;
    }

    for (const [key, value] of Object.entries(updates)) {
      this.env[key] = value;
    }
  }

  private async killRunning(signal: SupportedSignal): Promise<void> {
    const running = this.running;
    if (!running) return;

    try {
      this.sendSignal(running.process, signal);
    } catch {
      // Ignore.
    }

    await new Promise<void>((resolve) => {
      if (running.done || running.process.exitCode !== null) {
        resolve();
        return;
      }

      const onClose = () => {
        cleanup();
        resolve();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 2000);

      const cleanup = () => {
        clearTimeout(timer);
        running.process.off('close', onClose);
      };

      running.process.on('close', onClose);
    });

    this.running = null;
  }

  private sendSignal(proc: ChildProcessWithoutNullStreams, signal: SupportedSignal): void {
    if (!proc.pid) return;
    if (os.platform() !== 'win32') {
      try {
        process.kill(-proc.pid, signal);
        return;
      } catch {
        // Fall back to signaling the immediate process.
      }
    }
    try {
      proc.kill(signal);
    } catch {
      // Ignore.
    }
  }

  private signal(cmd: RunningTerminalProcess): void {
    if (cmd.waiters.size === 0) return;
    for (const waiter of cmd.waiters) {
      try {
        waiter();
      } catch {
        // Ignore waiter failures.
      }
    }
    cmd.waiters.clear();
  }

  private tryParseMeta(cmd: RunningTerminalProcess): void {
    const beginIndex = cmd.stdout.indexOf(cmd.meta.begin);
    if (beginIndex === -1) return;
    const endIndex = cmd.stdout.indexOf(cmd.meta.end, beginIndex);
    if (endIndex === -1) return;

    const blockStart = beginIndex + cmd.meta.begin.length;
    const block = cmd.stdout.slice(blockStart, endIndex);
    const lines = block.split(/\r?\n/).map((line) => line.trimEnd());

    const exitLine = lines.find((line) => line.startsWith(cmd.meta.exit));
    const pwdLine = lines.find((line) => line.startsWith(cmd.meta.pwd));
    const envLine = lines.find((line) => line.startsWith(cmd.meta.env));

    if (pwdLine) {
      const pwd = pwdLine.slice(cmd.meta.pwd.length).trim();
      if (pwd) this.cwd = pwd;
    }

    if (envLine) {
      const payload = envLine.slice(cmd.meta.env.length).trim();
      if (payload) {
        try {
          const decoded = Buffer.from(payload, 'base64').toString('utf8');
          const parsed = JSON.parse(decoded) as Record<string, unknown>;
          this.env = Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          );
        } catch {
          // Ignore env parse failures; keep previous env.
        }
      }
    }

    if (exitLine) {
      const raw = exitLine.slice(cmd.meta.exit.length).trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        cmd.exitCode = parsed;
      }
    }

    let removeEnd = endIndex + cmd.meta.end.length;
    if (cmd.stdout.slice(removeEnd, removeEnd + 2) === '\r\n') removeEnd += 2;
    else if (cmd.stdout.slice(removeEnd, removeEnd + 1) === '\n') removeEnd += 1;

    const oldOffset = cmd.stdoutOffset;
    const removedLength = removeEnd - beginIndex;
    cmd.stdout = cmd.stdout.slice(0, beginIndex) + cmd.stdout.slice(removeEnd);

    if (oldOffset <= beginIndex) {
      cmd.stdoutOffset = oldOffset;
    } else if (oldOffset >= removeEnd) {
      cmd.stdoutOffset = oldOffset - removedLength;
    } else {
      cmd.stdoutOffset = beginIndex;
    }
  }

  private async waitForNoChangeOrDone(cmd: RunningTerminalProcess, timeoutMs: number): Promise<'done' | 'no_change'> {
    if (cmd.done) return 'done';

    while (!cmd.done) {
      const elapsed = Date.now() - cmd.lastActivityTs;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) return 'no_change';

      await new Promise<void>((resolve) => {
        const waiter = () => {
          cleanup();
          resolve();
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, remaining);
        const cleanup = () => {
          clearTimeout(timer);
          cmd.waiters.delete(waiter);
        };
        cmd.waiters.add(waiter);
      });

      if (cmd.done) return 'done';
      if (Date.now() - cmd.lastActivityTs >= timeoutMs) return 'no_change';
    }

    return 'done';
  }

  private drain(cmd: RunningTerminalProcess): { stdout: string; stderr: string } {
    const stdout = cmd.stdout.slice(cmd.stdoutOffset);
    const stderr = cmd.stderr.slice(cmd.stderrOffset);
    cmd.stdoutOffset = cmd.stdout.length;
    cmd.stderrOffset = cmd.stderr.length;
    return { stdout, stderr };
  }

  async execute(args: {
    command: string;
    is_input: boolean;
    timeoutSeconds: number;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    done: boolean;
    command: string | null;
    previous: { stdout: string; stderr: string; exitCode: number | null; command: string } | null;
  }> {
    const timeoutMs = Math.max(0, Math.floor(args.timeoutSeconds * 1000));

    let completed: { stdout: string; stderr: string; exitCode: number | null; command: string } | null = null;
    let running = this.running;
    if (running?.done) {
      const drained = this.drain(running);
      completed = { ...drained, exitCode: running.exitCode, command: running.command };
      this.running = null;
      running = null;
    }

    if (running) {
      if (!args.is_input && args.command.trim().length > 0) {
        throw new Error(
          `Cannot start a new terminal command while another is running ($ ${running.command}). ` +
            `Poll with command="" or send input with is_input=true (e.g., "C-c" to interrupt).`,
        );
      }
      if (args.is_input) {
        const input = args.command ?? '';
        const trimmed = input.trim();
        if (trimmed === 'C-c') {
          this.sendSignal(running.process, 'SIGINT');
        } else if (trimmed === 'C-z') {
          this.sendSignal(running.process, 'SIGTSTP');
        } else if (trimmed === 'C-d') {
          running.process.stdin.write('\u0004');
        } else if (input.length > 0) {
          running.process.stdin.write(`${input}\n`);
        }
      }

      const status = await this.waitForNoChangeOrDone(running, timeoutMs);
      const drained = this.drain(running);
      const done = status === 'done';
      const exitCode = done ? running.exitCode : -1;
      const command = running.command;
      if (done) {
        this.running = null;
      }
      return { ...drained, exitCode, done, command, previous: null };
    }

    if (args.is_input) {
      if (completed) {
        return {
          stdout: completed.stdout,
          stderr: completed.stderr,
          exitCode: completed.exitCode,
          done: true,
          command: completed.command,
          previous: completed,
        };
      }
      return {
        stdout: '',
        stderr: 'No running terminal command to send input to.',
        exitCode: null,
        done: true,
        command: null,
        previous: null,
      };
    }

    if (completed && !args.command.trim()) {
      return {
        stdout: completed.stdout,
        stderr: completed.stderr,
        exitCode: completed.exitCode,
        done: true,
        command: completed.command,
        previous: completed,
      };
    }

    const id = randomUUID();
    const meta = {
      begin: `__OPENHANDS_META_${id}__BEGIN__`,
      end: `__OPENHANDS_META_${id}__END__`,
      exit: `__OPENHANDS_EXIT_${id}__`,
      pwd: `__OPENHANDS_PWD_${id}__`,
      env: `__OPENHANDS_ENV_${id}__`,
    };

    const platform = os.platform();
    const nodeExecutable = platform === 'win32' ? `"${process.execPath.replaceAll('"', '""')}"` : JSON.stringify(process.execPath);

    const scriptLines =
      platform === 'win32'
        ? [
            args.command,
            'set openhands_ec=%errorlevel%',
            `echo ${meta.begin}`,
            `echo ${meta.exit}%openhands_ec%`,
            `echo ${meta.pwd}%CD%`,
            `<nul set /p=${meta.env}`,
            `${nodeExecutable} -e "process.stdout.write(Buffer.from(JSON.stringify(process.env)).toString('base64'))"`,
            'echo.',
            `echo ${meta.end}`,
            'exit /b %openhands_ec%',
          ]
        : [
            args.command,
            'openhands_ec=$?',
            `printf '\\n${meta.begin}\\n'`,
            `printf '${meta.exit}%s\\n' "$openhands_ec"`,
            `printf '${meta.pwd}%s\\n' "$(pwd)"`,
            `printf '${meta.env}'`,
            `${nodeExecutable} -e 'process.stdout.write(Buffer.from(JSON.stringify(process.env)).toString("base64"))'`,
            "printf '\\n'",
            `printf '${meta.end}\\n'`,
            'exit $openhands_ec',
          ];

    const script = scriptLines.join(platform === 'win32' ? '\r\n' : '\n');

    const shellPath = platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/bash';
    const shellArgs = platform === 'win32' ? ['/d', '/s', '/c', script] : ['-c', script];

    const child = spawn(shellPath, shellArgs, {
      cwd: this.cwd,
      env: this.env,
      stdio: 'pipe',
      detached: platform !== 'win32',
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const cmd: RunningTerminalProcess = {
      id,
      command: args.command,
      process: child,
      stdout: '',
      stderr: '',
      stdoutOffset: 0,
      stderrOffset: 0,
      lastActivityTs: Date.now(),
      exitCode: null,
      done: false,
      meta,
      waiters: new Set(),
    };
    this.running = cmd;

    child.stdout.on('data', (data: Buffer | string) => {
      cmd.stdout += data.toString();
      cmd.lastActivityTs = Date.now();
      this.tryParseMeta(cmd);
      this.signal(cmd);
    });

    child.stderr.on('data', (data: Buffer | string) => {
      cmd.stderr += data.toString();
      cmd.lastActivityTs = Date.now();
      this.signal(cmd);
    });

    child.on('close', (code) => {
      cmd.done = true;
      cmd.exitCode = typeof code === 'number' ? code : cmd.exitCode ?? 0;
      this.tryParseMeta(cmd);
      this.signal(cmd);
    });

    const status = await this.waitForNoChangeOrDone(cmd, timeoutMs);
    const drained = this.drain(cmd);
    const done = status === 'done';
    const exitCode = done ? cmd.exitCode : -1;
    let stdout = drained.stdout;
    const stderr = drained.stderr;
    let previous: { stdout: string; stderr: string; exitCode: number | null; command: string } | null = null;
    if (completed) {
      const completedText = [completed.stdout, completed.stderr].filter(Boolean).join('');
      const header = `[Below is the output of the previous command ($ ${completed.command}, exit_code: ${completed.exitCode ?? 0}).]\n`;
      const spacer = completedText && !completedText.endsWith('\n') ? '\n' : '';
      stdout = `${header}${completedText}${spacer}${stdout}`;
      previous = completed;
    }
    if (done) {
      this.running = null;
    }
    return { stdout, stderr, exitCode, done, command: args.command, previous };
  }
}

const TOOL_DESCRIPTION = `Execute a bash command in the terminal within a persistent shell session.


### Command Execution
* One command at a time: You can only execute one bash command at a time. If you need to run multiple commands sequentially, use \`&&\` or \`;\` to chain them together.
  - If a command is still running (exit code \`-1\`), starting a different non-empty \`command\` will fail. Poll with \`command: ""\` or use \`is_input: true\` to interact with the running process.
* Persistent session: Commands execute in a persistent shell session where environment variables, virtual environments, and working directory persist between commands.
* Soft timeout: Commands have a soft timeout of 60 seconds, once that's reached, you have the option to continue or interrupt the command (see section below for details)
* Shell options: Do NOT use \`set -e\`, \`set -eu\`, or \`set -euo pipefail\` in shell scripts or commands in this environment. The runtime may not support them and can cause unusable shell sessions. If you want to run multi-line bash commands, write the commands to a file and then run it, instead.

### Long-running Commands
* For commands that may run indefinitely, run them in the background and redirect output to a file, e.g. \`python3 app.py > server.log 2>&1 &\`.
* For commands that may run for a long time (e.g. installation or testing commands), or commands that run for a fixed amount of time (e.g. sleep), you should set the "timeout" parameter of your function call to an appropriate value.
* If a bash command returns exit code \`-1\`, this means the process hit the soft timeout and is not yet finished. By setting \`is_input\` to \`true\`, you can:
  - Send empty \`command\` to retrieve additional logs
  - Send text (set \`command\` to the text) to STDIN of the running process
  - Send control commands like \`C-c\` (Ctrl+C), \`C-d\` (Ctrl+D), or \`C-z\` (Ctrl+Z) to interrupt the process
  - If you do C-c, you can re-start the process with a longer "timeout" parameter to let it run to completion

### Best Practices
* Directory verification: Before creating new directories or files, first verify the parent directory exists and is the correct location.
* Directory management: Try to maintain working directory by using absolute paths and avoiding excessive use of \`cd\`.

### Output Handling
* Output truncation: If the output exceeds a maximum length, it will be truncated before being returned.

### Terminal Reset
* Terminal reset: If the terminal becomes unresponsive, you can set the "reset" parameter to \`true\` to create a new session. Use this only when the terminal stops responding to commands.
* Warning: Resetting the terminal will lose all previously set environment variables, working directory changes, and any running processes. Use this only when the terminal stops responding to commands.
`;

const terminalSchema = z.object({
  command: z
    .string()
    .describe(
      'The bash command to execute. Can be empty string to poll additional logs when the previous exit code is `-1`. Can be `C-c` (Ctrl+C) to interrupt the currently running process (use with `is_input=true`). Note: You can only execute one bash command at a time. If a command is still running, starting a different non-empty command will fail.',
    ),
  is_input: z.boolean().optional().default(false).describe('If True, the command is an input to the running process. If False, the command is a bash command to be executed in the terminal. Default is False.'),
  timeout: z.number().nonnegative().optional().nullable().describe('Optional. Sets a maximum time limit (in seconds) for running the command. If the command takes longer than this limit, you’ll be asked whether to continue or stop it. If you don’t set a value, the command will instead pause and ask for confirmation when it produces no new output for 60 seconds. Use a higher value if the command is expected to take a long time (like installation or testing), or if it has a known fixed duration (like sleep).'),
  reset: z.boolean().optional().default(false).describe('If True, reset the terminal by creating a new session. Use this only when the terminal becomes unresponsive. Note that all previously set environment variables and session state will be lost after reset. Cannot be used with is_input=True.'),
});

export class TerminalTool extends ZodTool<z.infer<typeof terminalSchema>, TerminalResult> {
  readonly name = 'terminal';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = terminalSchema;
  private session: TerminalSession | null = null;
  private queue: Promise<TerminalResult> = Promise.resolve({ command: null, exit_code: 0, exitCode: 0, timeout: false, stdout: '', stderr: '' });

  async execute(args: z.infer<typeof terminalSchema>, context: ToolContext): Promise<TerminalResult> {
    const run = async (): Promise<TerminalResult> => {
      if (args.reset) {
        if (args.is_input) {
          throw new Error('reset cannot be used with is_input=true');
        }
        await this.session?.reset(context.workspace.root);
        this.session = null;
        return { command: args.command ?? '', exit_code: 0, exitCode: 0, timeout: false, stdout: '', stderr: 'Terminal session reset.' };
      }

      if (!this.session) {
        this.session = new TerminalSession(context.workspace.root);
      }

      const isInput = args.is_input ?? false;
      const command = args.command ?? '';
      if (!isInput && context.secrets) {
        await this.session.injectSecretsFromCommand(command, context.secrets);
      }

      const timeoutSeconds =
        typeof args.timeout === 'number' && Number.isFinite(args.timeout)
          ? args.timeout
          : DEFAULT_NO_CHANGE_TIMEOUT_SECONDS;

      const result = await this.session.execute({
        command,
        is_input: isInput,
        timeoutSeconds,
      });

      const exitCode = result.exitCode;
      const resolvedCommand = result.command ?? command;
      return {
        command: resolvedCommand,
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: exitCode,
        exitCode,
        timeout: exitCode === -1,
        previous: result.previous
          ? {
              command: result.previous.command,
              exit_code: result.previous.exitCode,
              exitCode: result.previous.exitCode,
              stdout: result.previous.stdout,
              stderr: result.previous.stderr,
            }
          : undefined,
      };
    };

    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.then(
      () => ({ command: null, exit_code: 0, exitCode: 0, timeout: false, stdout: '', stderr: '' }),
      () => ({ command: null, exit_code: 0, exitCode: 0, timeout: false, stdout: '', stderr: '' }),
    );
    return resultPromise;
  }
}
