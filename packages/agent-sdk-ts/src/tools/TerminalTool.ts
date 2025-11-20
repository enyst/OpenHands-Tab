import { z } from 'zod';
import { IntegratedTerminalRunner } from './IntegratedTerminalRunner';
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
  timeout?: boolean;
  stdout?: string;
  stderr?: string;
}

const TOOL_DESCRIPTION = `Execute a bash command in the terminal within a persistent shell session.


### Command Execution
* One command at a time: You can only execute one bash command at a time. If you need to run multiple commands sequentially, use \`&&\` or \`;\` to chain them together.
* Persistent session: Commands execute in a persistent shell session where environment variables, virtual environments, and working directory persist between commands.
* Soft timeout: Commands have a soft timeout of 10 seconds, once that's reached, you have the option to continue or interrupt the command (see section below for details)
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
  command: z.string().describe('The bash command to execute. Can be empty string to view additional logs when previous exit code is `-1`. Can be `C-c` (Ctrl+C) to interrupt the currently running process. Note: You can only execute one bash command at a time. If you need to run multiple commands sequentially, you can use `&&` or `;` to chain them together.'),
  is_input: z.boolean().optional().default(false).describe('If True, the command is an input to the running process. If False, the command is a bash command to be executed in the terminal. Default is False.'),
  timeout: z.number().nonnegative().optional().nullable().describe('Optional. Sets a maximum time limit (in seconds) for running the command. If the command takes longer than this limit, you’ll be asked whether to continue or stop it. If you don’t set a value, the command will instead pause and ask for confirmation when it produces no new output for 10 seconds. Use a higher value if the command is expected to take a long time (like installation or testing), or if it has a known fixed duration (like sleep).'),
  reset: z.boolean().optional().default(false).describe('If True, reset the terminal by creating a new session. Use this only when the terminal becomes unresponsive. Note that all previously set environment variables and session state will be lost after reset. Cannot be used with is_input=True.'),
});

export class TerminalTool extends ZodTool<z.infer<typeof terminalSchema>, TerminalResult> {
  readonly name = 'terminal';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = terminalSchema;

  async execute(args: z.infer<typeof terminalSchema>, context: ToolContext): Promise<TerminalResult> {
    // This TS SDK provides a per-invocation shell execution. Interactive input to a
    // running process is not supported in this environment.
    if (args.is_input) {
      return { command: args.command ?? '', exit_code: null, timeout: false, stderr: 'Interactive input to a running process is not supported in this environment.' };
    }

    const runner = new IntegratedTerminalRunner(context.workspace);
    const seconds = typeof args.timeout === 'number' && Number.isFinite(args.timeout) ? args.timeout : undefined;
    const timeoutMs = seconds !== undefined ? Math.max(0, Math.floor(seconds * 1000)) : undefined;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(new Error('Command timed out')), timeoutMs);
    }

    try {
      const result = await runner.execute(args.command, { signal: controller?.signal });
      return {
        command: result.command,
        stdout: result.stdout,
        stderr: controller?.signal.aborted ? (result.stderr || 'Command timed out') : result.stderr,
        exit_code: controller?.signal.aborted ? (result.exitCode || -1) : result.exitCode,
        timeout: controller?.signal.aborted || false,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
