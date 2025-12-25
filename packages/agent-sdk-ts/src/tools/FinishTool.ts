import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

const finishSchema = z.object({
  message: z
    .string()
    .optional()
    .describe('Optional short final message describing why the agent is finished.'),
});

export type FinishToolArgs = z.infer<typeof finishSchema>;

export type FinishToolResult = {
  message?: string;
};

export class FinishTool extends ZodTool<FinishToolArgs, FinishToolResult> {
  readonly name = 'finish';
  readonly description = 'Signal that the agent is finished and should stop the current run.';
  readonly schema = finishSchema;

  execute(args: FinishToolArgs, _context: ToolContext): Promise<FinishToolResult> {
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    return Promise.resolve(message ? { message } : {});
  }
}
