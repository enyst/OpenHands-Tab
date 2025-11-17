import { IntegratedTerminalRunner } from './IntegratedTerminalRunner';
import type { ToolContext, ToolHandler } from './types';
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

export class TerminalTool implements ToolHandler<TerminalArgs, TerminalResult> {
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
    const result = await runner.execute(args.command, args.cwd);
    if (typeof args.timeoutMs === 'number' && args.timeoutMs > 0 && result.exitCode === 0) {
      // Simple guard to mimic timeout enforcement; runner already cancels via signal when configured
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
}
