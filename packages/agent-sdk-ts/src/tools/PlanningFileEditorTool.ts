import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export type PlanningCommand = 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit';

export interface PlanningFileEditorResult {
  command: PlanningCommand;
  path: string;
  content?: string;
  message?: string;
}

const planningSchema = z
  .object({
    command: z
      .enum(['view', 'create', 'str_replace', 'insert', 'undo_edit'])
      .describe('Allowed options: `view`, `create`, `str_replace`, `insert`, `undo_edit`.'),
    path: z.string().describe('Absolute path to file or directory.'),
    file_text: z
      .string()
      .optional()
      .describe('Required for `create` command, with the content of the file to be created.'),
    old_str: z
      .string()
      .optional()
      .describe('Required for `str_replace` command containing the string in `path` to replace.'),
    new_str: z
      .string()
      .optional()
      .describe(
        'Optional for `str_replace` (new text to use). Required for `insert` containing the string to insert.',
      ),
    insert_line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Required for `insert`. The `new_str` will be inserted AFTER the line `insert_line` of `path`.'),
    view_range: z
      .array(z.number().int())
      .length(2)
      .optional()
      .describe(
        'Optional for `view` when `path` points to a file. If provided, the file will be shown in the indicated line number range.',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.command === 'create' && value.file_text === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'file_text is required for create', path: ['file_text'] });
    }
    if (value.command === 'str_replace' && value.old_str === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'old_str is required for str_replace', path: ['old_str'] });
    }
    if (value.command === 'insert') {
      if (value.new_str === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'new_str is required for insert', path: ['new_str'] });
      }
      if (value.insert_line === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'insert_line is required for insert', path: ['insert_line'] });
      }
    }
  });

const TOOL_DESCRIPTION = `Custom editing tool for viewing, creating and editing files in plain-text format
* State is persistent across command calls and discussions with the user
* If "path" is a text file, "view" displays the result of applying cat -n. If "path" is a directory, "view" lists non-hidden files and directories up to 2 levels deep
* The "create" command cannot be used if the specified "path" already exists as a file
* If a "command" generates a long output, it will be truncated and marked with <response clipped>
* The "undo_edit" command will revert the last edit made to the file at "path"
* This tool can be used for creating and editing files in plain-text format.


Before using this tool:
1. Use the view tool to understand the file's contents and context
2. Verify the directory path is correct (only applicable when creating new files):
   - Use the view tool to verify the parent directory exists and is the correct location

When making edits:
   - Ensure the edit results in idiomatic, correct code
   - Do not leave the code in a broken state
   - Always use absolute file paths (starting with /)

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. EXACT MATCHING: The "old_str" parameter must match EXACTLY one or more consecutive lines from the file, including all whitespace and indentation. The tool will fail if "old_str" matches multiple locations or doesn't match exactly with the file content.

2. UNIQUENESS: The "old_str" must uniquely identify a single instance in the file:
   - Include sufficient context before and after the change point (3-5 lines recommended)
   - If not unique, the replacement will not be performed

3. REPLACEMENT: The "new_str" parameter should contain the edited lines that replace the "old_str". Both strings must be different.

Remember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.

IMPORTANT RESTRICTION FOR PLANNING AGENT:
* You can VIEW any file in the workspace using the 'view' command
* You can ONLY EDIT the PLAN.md file (all other edit operations will be rejected)
* PLAN.md is automatically initialized with section headers at the workspace root
* All editing commands (create, str_replace, insert, undo_edit) are restricted to PLAN.md only
* The PLAN.md file already contains the required section structure - you just need to fill in the content`;

const PLAN_BASENAME = 'PLAN.md';

const applyViewRange = (content: string, viewRange?: number[]): string => {
  if (!viewRange || viewRange.length !== 2) return content;
  const [start, end] = viewRange;
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(start - 1, end === -1 ? undefined : end);
  return slice.join('\n');
};

export class PlanningFileEditorTool extends ZodTool<z.infer<typeof planningSchema>, PlanningFileEditorResult> {
  readonly name = 'planning_file_editor';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = planningSchema;

  private ensurePlanTarget(command: PlanningCommand, resolvedPath: string) {
    if (command === 'view') return;
    if (path.basename(resolvedPath) !== PLAN_BASENAME) {
      throw new Error('Only PLAN.md may be modified by this tool');
    }
  }

  async execute(args: z.infer<typeof planningSchema>, context: ToolContext): Promise<PlanningFileEditorResult> {
    const resolved = context.workspace.resolvePath(args.path);
    this.ensurePlanTarget(args.command, resolved);

    if (args.command === 'view') {
      try {
        const stats = await fs.stat(resolved);
        if (stats.isDirectory()) {
          const entries = await context.workspace.list(resolved);
          const listing = entries.map((entry) => `${entry.isDirectory ? 'd' : 'f'} ${entry.path}`).join('\n');
          return { command: 'view', path: resolved, content: listing };
        }
        const content = await fs.readFile(resolved, 'utf8');
        return { command: 'view', path: resolved, content: applyViewRange(content, args.view_range) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { command: 'view', path: resolved, message };
      }
    }

    if (args.command === 'create') {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, args.file_text ?? '', 'utf8');
      return { command: 'create', path: resolved, content: args.file_text ?? '' };
    }

    if (args.command === 'str_replace') {
      const current = await fs.readFile(resolved, 'utf8');
      const oldStr = args.old_str ?? '';
      const occurrences = current.split(oldStr).length - 1;
      if (occurrences === 0) {
        throw new Error('old_str not found in target file');
      }
      if (occurrences > 1) {
        throw new Error('old_str is not unique and matches multiple locations in the file');
      }
      const updated = current.replace(oldStr, args.new_str ?? '');
      await fs.writeFile(resolved, updated, 'utf8');
      return { command: 'str_replace', path: resolved, content: updated };
    }

    if (args.command === 'insert') {
      const current = await fs.readFile(resolved, 'utf8');
      const lines = current.split(/\r?\n/);
      const insertion = args.new_str ?? '';
      const index = Math.min(args.insert_line ?? 0, lines.length);
      lines.splice(index, 0, insertion);
      const updated = lines.join('\n');
      await fs.writeFile(resolved, updated, 'utf8');
      return { command: 'insert', path: resolved, content: updated };
    }

    return { command: 'undo_edit', path: resolved, message: 'Undo support is not implemented in this SDK stub.' };
  }
}

