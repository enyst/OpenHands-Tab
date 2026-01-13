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

const THINK_DESCRIPTION = `Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed.

Common use cases:
1. When exploring a repository and discovering the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective.
2. After receiving test results, use this tool to brainstorm ways to fix failing tests.
3. When planning a complex refactoring, use this tool to outline different approaches and their tradeoffs.
4. When designing a new feature, use this tool to think through architecture decisions and implementation details.
5. When debugging a complex issue, use this tool to organize your thoughts and hypotheses.

The tool simply logs your thought process for better transparency and does not execute any code or make changes.`;

export class ThinkTool extends ZodTool<ThinkToolArgs, ThinkToolResult> {
  readonly name = 'think';
  readonly description = THINK_DESCRIPTION;
  readonly schema = thinkSchema;

  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(_args: ThinkToolArgs, _context: ToolContext): Promise<ThinkToolResult> {
    return { message: 'Your thought has been logged.' };
  }
}

