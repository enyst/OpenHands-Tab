import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

const thinkSchema = z.object({
  thought: z.string().min(1).describe('The thought to log.'),
});

export type ThinkToolArgs = z.infer<typeof thinkSchema>;

export type ThinkToolResult = {
  message: string;
};

const THINK_DESCRIPTION = 'Log a thought without side effects. This tool does not execute code or modify the workspace.';

export class ThinkTool extends ZodTool<ThinkToolArgs, ThinkToolResult> {
  readonly name = 'think';
  readonly description = THINK_DESCRIPTION;
  readonly schema = thinkSchema;

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(_args: ThinkToolArgs, _context: ToolContext): Promise<ThinkToolResult> {
    return { message: 'Your thought has been logged.' };
  }
}
