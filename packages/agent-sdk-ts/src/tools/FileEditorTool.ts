import fs from 'fs/promises';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export interface FileEditorResult {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit';
  path?: string;
  prev_exist?: boolean;
  old_content?: string | null;
  new_content?: string | null;
}

const TOOL_DESCRIPTION = `Custom editing tool for viewing, creating and editing files in plain-text format
* State is persistent across command calls and discussions with the user
* If \`path\` is a text file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists the entries in that directory (non-recursive)
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* The \`undo_edit\` command undoes the most recent edit for a \`path\` (including undoing a create)
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`
* This tool can be used for creating and editing files in plain-text format.


Before using this tool:
1. Use the view tool to understand the file's contents and context
2. Verify the directory path is correct (only applicable when creating new files):
   - Use the view tool to verify the parent directory exists and is the correct location

When making edits:
   - Ensure the edit results in idiomatic, correct code
   - Do not leave the code in a broken state
   - Prefer workspace-relative paths; absolute paths are allowed when they resolve inside the workspace (or other explicitly-allowed roots)

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. EXACT MATCHING: The \`old_str\` parameter must match EXACTLY a substring of the file, including all whitespace and indentation. It may span multiple lines. The tool will fail if \`old_str\` matches multiple locations or doesn't match exactly.

2. UNIQUENESS: The \`old_str\` must uniquely identify a single instance in the file:
   - Include sufficient context before and after the change point (3-5 lines recommended)
   - If not unique, the replacement will not be performed

3. REPLACEMENT: The \`new_str\` parameter should contain the edited lines that replace the \`old_str\`. Both strings must be different.

Remember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.
`;

const fileEditorSchema = z
  .object({
    command: z
      .enum(['view', 'create', 'str_replace', 'insert', 'undo_edit'])
      .describe('The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`, `undo_edit`.'),
    path: z
      .string()
      .describe('Workspace-relative path (preferred), or absolute path that resolves inside the workspace (or other explicitly-allowed roots).'),
    file_text: z
      .string()
      .optional()
      .describe('Required parameter of `create` command, with the content of the file to be created.'),
    old_str: z
      .string()
      .optional()
      .describe('Required parameter of `str_replace` command containing the string in `path` to replace.'),
    new_str: z
      .string()
      .optional()
      .describe('Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.'),
    insert_line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Line number to insert `new_str` after. Line numbers are 1-based. Use `insert_line: 0` to insert at the beginning of the file.'),
    view_range: z
      .array(z.number().int())
      .length(2)
      .optional()
      .describe('Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.'),
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

const applyViewRange = (content: string, viewRange?: number[]): string => {
  if (!viewRange || viewRange.length !== 2) return content;
  const [start, end] = viewRange;
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(start - 1, end === -1 ? undefined : end);
  return slice.join('\n');
};

const addLineNumbers = (content: string): string => {
  const lines = content.split(/\r?\n/);
  return lines.map((line, idx) => `${idx + 1}\t${line}`).join('\n');
};

const truncateContent = (content: string, limit = 500): string => {
  if (content.length <= limit * 2) return content;
  const head = content.slice(0, limit);
  const tail = content.slice(-limit);
  return `${head}\n<response clipped>\n${tail}`;
};

type UndoEntry = {
  prevExist: boolean;
  oldContent: string | null;
};

const MAX_UNDO_ENTRIES_PER_PATH = 10;

export class FileEditorTool extends ZodTool<z.infer<typeof fileEditorSchema>, FileEditorResult> {
  readonly name = 'file_editor';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = fileEditorSchema;
  private readonly undoHistory = new Map<string, UndoEntry[]>();

  private async pathExists(absPath: string): Promise<boolean> {
    try {
      await fs.stat(absPath);
      return true;
    } catch {
      return false;
    }
  }

  async execute(args: z.infer<typeof fileEditorSchema>, context: ToolContext): Promise<FileEditorResult> {
    const ws = context.workspace;
    const resolved = ws.resolvePath(args.path);

    switch (args.command) {
      case 'view': {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          const entries = await ws.list(args.path);
          const listing = entries.map((entry) => `${entry.isDirectory ? 'd' : 'f'} ${entry.path}`).join('\n');
          return { command: 'view', path: resolved, prev_exist: true, old_content: null, new_content: listing };
        }
        const content = await ws.readFile(args.path, 'utf8');
        const ranged = applyViewRange(content, args.view_range);
        const numbered = addLineNumbers(ranged);
        const truncated = truncateContent(numbered);
        return { command: 'view', path: resolved, prev_exist: true, old_content: content, new_content: truncated };
      }
      case 'create': {
        const exists = await this.pathExists(resolved);
        if (exists) {
          throw new Error('create failed: file already exists');
        }
        await ws.writeFile(args.path, args.file_text ?? '');
        this.pushUndo(resolved, { prevExist: false, oldContent: null });
        return { command: 'create', path: resolved, prev_exist: false, old_content: null, new_content: args.file_text ?? '' };
      }
      case 'str_replace': {
        const prev = await ws.readFile(args.path, 'utf8');
        const oldStr = args.old_str ?? '';
        const firstMatch = prev.indexOf(oldStr);
        if (firstMatch === -1) {
          throw new Error('old_str not found in target file');
        }
        const secondMatch = prev.indexOf(oldStr, firstMatch + 1);
        if (secondMatch !== -1) {
          throw new Error('old_str is not unique and matches multiple locations in the file');
        }
        const updated = prev.replace(oldStr, args.new_str ?? '');
        await ws.writeFile(args.path, updated);
        this.pushUndo(resolved, { prevExist: true, oldContent: prev });
        return { command: 'str_replace', path: resolved, prev_exist: true, old_content: prev, new_content: updated };
      }
      case 'insert': {
        const prev = await ws.readFile(args.path, 'utf8');
        const lines = prev.split(/\r?\n/);
        const insertion = args.new_str ?? '';
        const index = Math.min(args.insert_line ?? 0, lines.length);
        lines.splice(index, 0, insertion);
        const updated = lines.join('\n');
        await ws.writeFile(args.path, updated);
        this.pushUndo(resolved, { prevExist: true, oldContent: prev });
        return { command: 'insert', path: resolved, prev_exist: true, old_content: prev, new_content: updated };
      }
      case 'undo_edit': {
        const current = await this.readOptionalFile(resolved);

        const stack = this.undoHistory.get(resolved);
        if (!stack || stack.length === 0) {
          throw new Error('undo_edit failed: no edit history for path');
        }

        const undo = stack[stack.length - 1];

	        if (!undo.prevExist) {
	          await this.removeCreatedFile(resolved);
	        } else {
	          await ws.writeFile(args.path, undo.oldContent ?? '');
	        }

        stack.pop();
        if (stack.length === 0) {
          this.undoHistory.delete(resolved);
        }

        if (!undo.prevExist) {
          return { command: 'undo_edit', path: resolved, prev_exist: undo.prevExist, old_content: current, new_content: null };
        }
        return { command: 'undo_edit', path: resolved, prev_exist: undo.prevExist, old_content: current, new_content: undo.oldContent };
      }
      default: {
        const unreachable: never = args.command;
        throw new Error(`Unsupported command: ${String(unreachable)}`);
      }
    }
  }

  private pushUndo(resolvedPath: string, entry: UndoEntry): void {
    const stack = this.undoHistory.get(resolvedPath) ?? [];
    stack.push(entry);
    while (stack.length > MAX_UNDO_ENTRIES_PER_PATH) {
      stack.shift();
    }
    this.undoHistory.set(resolvedPath, stack);
  }

  private async readOptionalFile(absPath: string): Promise<string | null> {
    try {
      return await fs.readFile(absPath, 'utf8');
    } catch {
      return null;
    }
  }

  private async removeCreatedFile(absPath: string): Promise<void> {
    try {
      const stat = await fs.lstat(absPath);
      if (stat.isDirectory()) {
        throw new Error(`undo_edit failed: refusing to delete directory: ${absPath}`);
      }
      await fs.unlink(absPath);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return;
      throw error;
    }
  }
}
