import type { ChildProcessWithoutNullStreams } from 'child_process';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import os from 'os';

export const DEFAULT_NO_CHANGE_TIMEOUT_SECONDS = 30;
export const TIMEOUT_MESSAGE_TEMPLATE =
  'You may wait longer to see additional output by sending an empty command, send other commands to interact with the current process, send keys ("C-c", "C-z", "C-d") to interrupt/kill the previous command before sending your new command, or use the timeout parameter in terminal for future commands.';

type SupportedSignal = 'SIGTERM' | 'SIGINT' | 'SIGTSTP';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const commandReferencesSecret = (command: string, name: string): boolean => {
  if (!command || !name) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
  return pattern.test(command);
};

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

export interface TerminalSessionSecrets {
  getRegisteredNames: () => string[];
  get: (name: string) => Promise<string | undefined>;
}

export interface TerminalSessionExecuteArgs {
  command: string;
  is_input: boolean;
  noChangeTimeoutSeconds: number | null;
  hardTimeoutSeconds: number | null;
}

export interface TerminalSessionExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  done: boolean;
  command: string | null;
  previous: { stdout: string; stderr: string; exitCode: number | null; command: string } | null;
}

export class TerminalSession {
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

  async injectSecretsFromCommand(command: string, secrets: TerminalSessionSecrets): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;
    const names = secrets.getRegisteredNames();
    if (!names.length) return;

    const updates: Record<string, string> = {};

    for (const name of names) {
      const candidate = typeof name === 'string' ? name.trim() : '';
      if (!candidate) continue;
      if (!commandReferencesSecret(command, candidate)) continue;
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
        cmd.done = true;
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

  private async waitForState(
    cmd: RunningTerminalProcess,
    opts: { callStart: number; noChangeTimeoutMs: number | null; hardTimeoutMs: number | null },
  ): Promise<'done' | 'no_change' | 'hard_timeout'> {
    if (cmd.done) return 'done';

    while (!cmd.done) {
      const now = Date.now();
      const elapsedSinceActivity = now - cmd.lastActivityTs;
      const elapsedSinceCall = now - opts.callStart;

      if (opts.hardTimeoutMs !== null && elapsedSinceCall >= opts.hardTimeoutMs) {
        return 'hard_timeout';
      }
      if (opts.noChangeTimeoutMs !== null && elapsedSinceActivity >= opts.noChangeTimeoutMs) {
        return 'no_change';
      }

      const waits: number[] = [];
      if (opts.hardTimeoutMs !== null) waits.push(Math.max(0, opts.hardTimeoutMs - elapsedSinceCall));
      if (opts.noChangeTimeoutMs !== null) waits.push(Math.max(0, opts.noChangeTimeoutMs - elapsedSinceActivity));
      const waitMs = waits.length > 0 ? Math.min(...waits) : 1000;

      await new Promise<void>((resolve) => {
        const waiter = () => {
          cleanup();
          resolve();
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, waitMs);
        const cleanup = () => {
          clearTimeout(timer);
          cmd.waiters.delete(waiter);
        };
        cmd.waiters.add(waiter);
      });
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

  async execute(args: TerminalSessionExecuteArgs): Promise<TerminalSessionExecuteResult> {
    const noChangeTimeoutMs =
      args.noChangeTimeoutSeconds !== null && args.noChangeTimeoutSeconds !== undefined
        ? Math.max(0, Math.floor(args.noChangeTimeoutSeconds * 1000))
        : null;
    const hardTimeoutMs =
      args.hardTimeoutSeconds !== null && args.hardTimeoutSeconds !== undefined
        ? Math.max(0, Math.floor(args.hardTimeoutSeconds * 1000))
        : null;
    const callStart = Date.now();

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
        const drained = this.drain(running);
        const header = `[Your command "${args.command}" was NOT executed. The previous command ($ ${running.command}) is still running - you cannot send new commands until it completes. ${TIMEOUT_MESSAGE_TEMPLATE}]\n`;
        return {
          stdout: `${header}${drained.stdout}`,
          stderr: drained.stderr,
          exitCode: -1,
          done: false,
          command: args.command,
          previous: null,
        };
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

      const status = await this.waitForState(running, { callStart, noChangeTimeoutMs, hardTimeoutMs });
      const drained = this.drain(running);
      const done = status === 'done';
      const exitCode = done ? running.exitCode : -1;
      const command = running.command;
      let stdout = drained.stdout;
      if (status === 'no_change' && noChangeTimeoutMs !== null) {
        const timeoutSeconds = (noChangeTimeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
        stdout += `${stdout.endsWith('\n') || stdout.length === 0 ? '' : '\n'}[The command has no new output after ${timeoutSeconds} seconds. ${TIMEOUT_MESSAGE_TEMPLATE}]`;
      }
      if (status === 'hard_timeout' && hardTimeoutMs !== null) {
        const timeoutSeconds = (hardTimeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
        stdout += `${stdout.endsWith('\n') || stdout.length === 0 ? '' : '\n'}[The command timed out after ${timeoutSeconds} seconds. ${TIMEOUT_MESSAGE_TEMPLATE}]`;
      }
      if (done) {
        this.running = null;
      }
      return { ...drained, stdout, exitCode, done, command, previous: null };
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
      cmd.lastActivityTs = Date.now();
      cmd.exitCode = typeof code === 'number' ? code : cmd.exitCode ?? 0;
      this.tryParseMeta(cmd);
      this.signal(cmd);
    });

    const status = await this.waitForState(cmd, { callStart, noChangeTimeoutMs, hardTimeoutMs });
    const drained = this.drain(cmd);
    const done = status === 'done';
    const exitCode = done ? cmd.exitCode : -1;
    let stdout = drained.stdout;
    const stderr = drained.stderr;
    let previous: { stdout: string; stderr: string; exitCode: number | null; command: string } | null = null;
    if (status === 'no_change' && noChangeTimeoutMs !== null) {
      const timeoutSeconds = (noChangeTimeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
      stdout += `${stdout.endsWith('\n') || stdout.length === 0 ? '' : '\n'}[The command has no new output after ${timeoutSeconds} seconds. ${TIMEOUT_MESSAGE_TEMPLATE}]`;
    }
    if (status === 'hard_timeout' && hardTimeoutMs !== null) {
      const timeoutSeconds = (hardTimeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
      stdout += `${stdout.endsWith('\n') || stdout.length === 0 ? '' : '\n'}[The command timed out after ${timeoutSeconds} seconds. ${TIMEOUT_MESSAGE_TEMPLATE}]`;
    }
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
