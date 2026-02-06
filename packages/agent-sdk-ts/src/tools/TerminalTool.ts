import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';
import { DEFAULT_NO_CHANGE_TIMEOUT_SECONDS, TerminalSession } from './terminalSession';

export interface TerminalArgs {
  command: string;
  is_input?: boolean;
  timeout?: number | null; // seconds
  reset?: boolean;
}

export interface TerminalResult {
  command?: string | null;
  exit_code?: number | null;
  timeout?: boolean;
  stdout?: string;
  stderr?: string;
  previous?: {
    command: string;
    exit_code: number | null;
    stdout: string;
    stderr: string;
  };
}

const TOOL_DESCRIPTION = `Execute a bash command in the terminal within a persistent shell session.


### Command Execution
* One command at a time: You can only execute one bash command at a time. If you need to run multiple commands sequentially, use \`&&\` or \`;\` to chain them together.
  - If a command is still running (exit code \`-1\`), starting a different non-empty \`command\` will fail. Poll with \`command: ""\` or use \`is_input: true\` to interact with the running process.
* Persistent session: Commands execute in a persistent shell session where environment variables, virtual environments, and working directory persist between commands.
* Soft timeout: Commands have a soft timeout of 30 seconds with no new output when no timeout is provided. If you set the "timeout" parameter on a call, it acts as a hard limit for how long that call will wait before returning (even if output is still streaming).
* Shell options: Do NOT use \`set -e\`, \`set -eu\`, or \`set -euo pipefail\` in shell scripts or commands in this environment. The runtime may not support them and can cause unusable shell sessions. If you want to run multi-line bash commands, write the commands to a file and then run it, instead.

### Long-running Commands
* For commands that may run indefinitely, run them in the background and redirect output to a file, e.g. \`python3 app.py > server.log 2>&1 &\`.
* For commands that may run for a long time (e.g. installation or testing commands), or commands that run for a fixed amount of time (e.g. sleep), you should set the "timeout" parameter of your function call to an appropriate value to control how long each call waits before returning.
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
  timeout: z.number().nonnegative().optional().nullable().describe('Optional. Sets a maximum time limit (in seconds) for running the command. If the command takes longer than this limit, you’ll be asked whether to continue or stop it. If you don’t set a value, the command will instead pause and ask for confirmation when it produces no new output for 30 seconds. Use a higher value if the command is expected to take a long time (like installation or testing), or if it has a known fixed duration (like sleep).'),
  reset: z.boolean().optional().default(false).describe('If True, reset the terminal by creating a new session. Use this only when the terminal becomes unresponsive. Note that all previously set environment variables and session state will be lost after reset. Cannot be used with is_input=True.'),
});

export class TerminalTool extends ZodTool<z.infer<typeof terminalSchema>, TerminalResult> {
  readonly name = 'terminal';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = terminalSchema;
  private session: TerminalSession | null = null;
  private queue: Promise<TerminalResult> = Promise.resolve({ command: null, exit_code: 0, timeout: false, stdout: '', stderr: '' });

  async execute(args: z.infer<typeof terminalSchema>, context: ToolContext): Promise<TerminalResult> {
    const run = async (): Promise<TerminalResult> => {
      if (args.reset) {
        if (args.is_input) {
          throw new Error('reset cannot be used with is_input=true');
        }
        await this.session?.reset(context.workspace.root);
        this.session = null;
        return { command: args.command ?? '', exit_code: 0, timeout: false, stdout: '', stderr: 'Terminal session reset.' };
      }

      if (!this.session) {
        this.session = new TerminalSession(context.workspace.root);
      }

      const isInput = args.is_input ?? false;
      const command = args.command ?? '';
      if (!isInput && context.secrets) {
        await this.session.injectSecretsFromCommand(command, context.secrets);
      }

      const hasHardTimeout = typeof args.timeout === 'number' && Number.isFinite(args.timeout);
      const hardTimeoutSeconds = hasHardTimeout ? Math.max(0, args.timeout ?? 0) : null;
      const noChangeTimeoutSeconds = hasHardTimeout ? null : DEFAULT_NO_CHANGE_TIMEOUT_SECONDS;

      const result = await this.session.execute({
        command,
        is_input: isInput,
        hardTimeoutSeconds,
        noChangeTimeoutSeconds,
      });

      const mask = (text: string | undefined) => {
        const values = context.secrets?.getRegisteredValues?.() ?? [];
        const sorted = values.filter(Boolean).sort((a, b) => b.length - a.length);
        let masked = text ?? '';
        for (const value of sorted) {
          masked = masked.split(value).join('<secret-hidden>');
        }
        return masked;
      };
      const exitCode = result.exitCode;
      const resolvedCommand = result.command ?? command;
      return {
        command: resolvedCommand,
        stdout: mask(result.stdout),
        stderr: mask(result.stderr),
        exit_code: exitCode,
        timeout: exitCode === -1,
        previous: result.previous
          ? {
              command: result.previous.command,
              exit_code: result.previous.exitCode,
              stdout: mask(result.previous.stdout),
              stderr: mask(result.previous.stderr),
            }
          : undefined,
      };
    };

    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.then(
      () => ({ command: null, exit_code: 0, timeout: false, stdout: '', stderr: '' }),
      () => ({ command: null, exit_code: 0, timeout: false, stdout: '', stderr: '' }),
    );
    return resultPromise;
  }
}
