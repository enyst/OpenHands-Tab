import { z } from 'zod';

export const TOOL_DESCRIPTION = `Custom editing tool for viewing, creating and editing files in plain-text format
* State is persistent across command calls and discussions with the user
* If \`path\` is a text file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* The \`undo_edit\` command undoes the most recent edit for a \`path\` (including undoing a create)
* Files larger than 10MB are rejected
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

export const fileEditorSchema = z
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
    if (value.command === 'str_replace') {
      if (value.old_str === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'old_str is required for str_replace', path: ['old_str'] });
      } else if (value.old_str.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'old_str must be non-empty for str_replace', path: ['old_str'] });
      }
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

export type FileEditorArgs = z.infer<typeof fileEditorSchema>;
