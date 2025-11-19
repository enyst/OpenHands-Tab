import { IntegratedTerminalRunner } from './IntegratedTerminalRunner';
import type { ToolContext, ToolDefinition } from './types';
import { requireObject, requireString, optionalString, optionalNumber } from './validation';

export interface TerminalArgs {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TerminalTool implements ToolDefinition<TerminalArgs, TerminalResult> {
  readonly name = 'terminal';

  validate(input: unknown): TerminalArgs {
    const obj = requireObject(input, 'terminal args');
    const command = requireString(obj.command, 'command');
    const cwd = optionalString(obj.cwd, 'cwd');
    const timeoutMs = optionalNumber(obj.timeoutMs, 'timeoutMs');
    return { command, cwd, timeoutMs };
  }

  async execute(args: TerminalArgs, context: ToolContext): Promise<TerminalResult> {
    const runner = new IntegratedTerminalRunner(context.workspace);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    if (args.timeoutMs && args.timeoutMs > 0) {
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(new Error('Command timed out')), args.timeoutMs);
    }

    try {
      const result = await runner.execute(args.command, { cwd: args.cwd, signal: controller?.signal });
      return {
        stdout: result.stdout,
        stderr: controller?.signal.aborted ? result.stderr || 'Command timed out' : result.stderr,
        exitCode: controller?.signal.aborted ? result.exitCode || -1 : result.exitCode,
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
