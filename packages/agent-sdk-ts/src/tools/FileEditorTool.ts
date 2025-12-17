import fs from 'fs/promises';
import path from 'path';
import type { Dirent } from 'node:fs';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

type FileEditorContent = { type: 'text'; text: string } | { type: 'image'; image_urls?: string[]; detail?: string };

export interface FileEditorResult {
  command: 'view' | 'create' | 'str_replace' | 'insert' | 'undo_edit';
  path?: string;
  prev_exist?: boolean;
  old_content?: string | null;
  new_content?: string | null;
  content?: FileEditorContent[];
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_IMAGE_BASE64_CHARS = 4 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const PDF_EXTENSION = '.pdf';

const TOOL_DESCRIPTION = `Custom editing tool for viewing, creating and editing files in plain-text format
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

const isProbablyBinary = (buffer: Buffer): boolean => {
  if (buffer.length === 0) return false;
  const sampleSize = Math.min(buffer.length, 8000);
  let suspiciousBytes = 0;
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
    // Count control chars excluding common whitespace (\t \n \r).
    if ((byte < 7 || (byte > 13 && byte < 32) || byte === 127) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes++;
    }
  }
  return suspiciousBytes / sampleSize > 0.3;
};

type UndoEntry = {
  prevExist: boolean;
  oldContent: string | null;
  byteSize: number;
};

const MAX_UNDO_ENTRIES_PER_PATH = 10;
const MAX_UNDO_PATHS = 100;
const MAX_UNDO_BYTES_TOTAL = 100 * 1024 * 1024;

export class FileEditorTool extends ZodTool<z.infer<typeof fileEditorSchema>, FileEditorResult> {
  readonly name = 'file_editor';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = fileEditorSchema;
  private readonly undoHistory = new Map<string, UndoEntry[]>();
  private undoBytesTotal = 0;

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
    const extension = path.extname(resolved).toLowerCase();

    switch (args.command) {
      case 'view': {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          const { text } = await this.viewDirectory(resolved, ws.root);
          return { command: 'view', path: resolved, prev_exist: true, old_content: null, new_content: text };
        }
        const buffer = await this.readValidatedFile(resolved, extension);
        if (IMAGE_EXTENSIONS.has(extension)) {
          return this.viewImage(resolved, extension, buffer);
        }
        const content = buffer.toString('utf8');
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
        const fileText = args.file_text ?? '';
        const sizeBytes = Buffer.byteLength(fileText, 'utf8');
        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
          const mb = sizeBytes / 1024 / 1024;
          throw new Error(`create failed: file is too large (${mb.toFixed(1)}MB). Maximum allowed size is 10MB.`);
        }
        await ws.writeFile(resolved, fileText);
        this.pushUndo(resolved, { prevExist: false, oldContent: null, byteSize: 0 });
        return {
          command: 'create',
          path: resolved,
          prev_exist: false,
          old_content: null,
          new_content: truncateContent(fileText),
        };
      }
      case 'str_replace': {
        if (IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION) {
          throw new Error(`str_replace failed: refusing to edit binary file type: ${extension}`);
        }
        const buffer = await this.readValidatedFile(resolved, extension);
        const prev = buffer.toString('utf8');
        const oldStr = args.old_str ?? '';
        if (oldStr.length === 0) {
          throw new Error('old_str must be non-empty for str_replace');
        }
        const firstMatch = prev.indexOf(oldStr);
        if (firstMatch === -1) {
          throw new Error('old_str not found in target file');
        }
        const secondMatch = prev.indexOf(oldStr, firstMatch + 1);
        if (secondMatch !== -1) {
          throw new Error('old_str is not unique and matches multiple locations in the file');
        }
        const updated = prev.replace(oldStr, args.new_str ?? '');
        const undoByteSize = Math.max(buffer.length, prev.length * 2);
        if (undoByteSize > MAX_UNDO_BYTES_TOTAL) {
          throw new Error('str_replace failed: undo snapshot exceeds total undo history size cap');
        }
        await ws.writeFile(resolved, updated);
        this.pushUndo(resolved, { prevExist: true, oldContent: prev, byteSize: undoByteSize });
        return { command: 'str_replace', path: resolved, prev_exist: true, old_content: prev, new_content: updated };
      }
      case 'insert': {
        if (IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION) {
          throw new Error(`insert failed: refusing to edit binary file type: ${extension}`);
        }
        const buffer = await this.readValidatedFile(resolved, extension);
        const prev = buffer.toString('utf8');
        const lines = prev.split(/\r?\n/);
        const insertion = args.new_str ?? '';
        const index = Math.min(args.insert_line ?? 0, lines.length);
        lines.splice(index, 0, insertion);
        const updated = lines.join('\n');
        const undoByteSize = Math.max(buffer.length, prev.length * 2);
        if (undoByteSize > MAX_UNDO_BYTES_TOTAL) {
          throw new Error('insert failed: undo snapshot exceeds total undo history size cap');
        }
        await ws.writeFile(resolved, updated);
        this.pushUndo(resolved, { prevExist: true, oldContent: prev, byteSize: undoByteSize });
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
        this.undoBytesTotal -= undo.byteSize;
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

  private async readValidatedFile(absPath: string, extension: string): Promise<Buffer> {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${absPath}`);
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const mb = stat.size / 1024 / 1024;
      throw new Error(`File is too large (${mb.toFixed(1)}MB). Maximum allowed size is 10MB.`);
    }

    const buffer = await fs.readFile(absPath);
    const binaryAllowed = IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION;
    if (!binaryAllowed && isProbablyBinary(buffer)) {
      throw new Error('File appears to be binary and this file type cannot be read or edited by this tool.');
    }
    return buffer;
  }

  private async viewDirectory(absPath: string, workspaceRoot: string): Promise<{ text: string }> {
    const toDisplayPath = (absolutePath: string): string => {
      const relative = path.relative(workspaceRoot, absolutePath);
      if (!relative || relative === '') return '.';
      if (relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath;
      return relative;
    };

    const topEntries = await fs.readdir(absPath, { withFileTypes: true });
    const hiddenCount = topEntries.filter((entry) => entry.name.startsWith('.')).length;

    const visibleTop = topEntries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, abs: path.join(absPath, entry.name), isDir: entry.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const displayRoot = toDisplayPath(absPath);
    const lines: string[] = [`d ${displayRoot}`];

    for (const entry of visibleTop) {
      const displayEntry = toDisplayPath(entry.abs);
      lines.push(`${entry.isDir ? 'd' : 'f'} ${displayEntry}`);
      if (!entry.isDir) continue;

      let childEntries: Dirent[];
      try {
        childEntries = await fs.readdir(entry.abs, { withFileTypes: true });
      } catch {
        lines.push(`skipped unreadable: ${displayEntry}`);
        continue;
      }
      const visibleChildren = childEntries
        .filter((child) => !child.name.startsWith('.'))
        .map((child) => ({ name: child.name, abs: path.join(entry.abs, child.name), isDir: child.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const child of visibleChildren) {
        const displayChild = toDisplayPath(child.abs);
        lines.push(`${child.isDir ? 'd' : 'f'} ${displayChild}`);
      }
    }

    const header = `Here's the files and directories up to 2 levels deep in ${displayRoot}, excluding hidden items:\n`;
    const body = lines.join('\n');
    const hiddenNote =
      hiddenCount > 0
        ? `\n\n${hiddenCount} hidden files/directories in the top-level directory are excluded. You can use 'ls -la ${displayRoot}' to see them.`
        : '';
    return { text: truncateContent(`${header}${body}${hiddenNote}`) };
  }

  private viewImage(absPath: string, extension: string, buffer: Buffer): FileEditorResult {
    const mime = (() => {
      switch (extension) {
        case '.png':
          return 'image/png';
        case '.jpg':
        case '.jpeg':
          return 'image/jpeg';
        case '.gif':
          return 'image/gif';
        case '.webp':
          return 'image/webp';
        case '.bmp':
          return 'image/bmp';
        default:
          return 'image/png';
      }
    })();
    const estimatedBase64Length = Math.ceil(buffer.length / 3) * 4;
    if (estimatedBase64Length > MAX_INLINE_IMAGE_BASE64_CHARS) {
      const mb = buffer.length / 1024 / 1024;
      const inlineLimitBytes = Math.floor(MAX_INLINE_IMAGE_BASE64_CHARS * 3 / 4);
      const inlineLimitMb = inlineLimitBytes / 1024 / 1024;
      const text = `Image file ${absPath} is too large to inline (${mb.toFixed(1)}MB). Files up to 10MB are allowed, but inline image previews are capped at ~${inlineLimitMb.toFixed(1)}MB.`;
      return {
        command: 'view',
        path: absPath,
        prev_exist: true,
        old_content: null,
        new_content: text,
        content: [{ type: 'text', text }],
      };
    }

    const imageBase64 = buffer.toString('base64');
    const imageUrl = `data:${mime};base64,${imageBase64}`;
    const text = `Image file ${absPath} read successfully. Displaying image content.`;
    return {
      command: 'view',
      path: absPath,
      prev_exist: true,
      old_content: null,
      new_content: text,
      content: [{ type: 'text', text }, { type: 'image', image_urls: [imageUrl] }],
    };
  }

  private pushUndo(resolvedPath: string, entry: UndoEntry): void {
    const stack = this.undoHistory.get(resolvedPath) ?? [];
    stack.push(entry);
    this.undoBytesTotal += entry.byteSize;
    while (stack.length > MAX_UNDO_ENTRIES_PER_PATH) {
      const removed = stack.shift();
      if (removed) {
        this.undoBytesTotal -= removed.byteSize;
      }
    }
    this.undoHistory.delete(resolvedPath);
    this.undoHistory.set(resolvedPath, stack);
    while (this.undoHistory.size > MAX_UNDO_PATHS) {
      this.dropOldestUndoPath();
    }
    while (this.undoBytesTotal > MAX_UNDO_BYTES_TOTAL) {
      if (this.dropOldestUndoPath(resolvedPath)) continue;
      if (this.dropOldestUndoEntryForPath(resolvedPath)) continue;
      break;
    }
  }

  private dropOldestUndoPath(excludePath?: string): boolean {
    for (const key of this.undoHistory.keys()) {
      if (excludePath && key === excludePath) continue;

      const stack = this.undoHistory.get(key);
      if (stack) {
        for (const entry of stack) {
          this.undoBytesTotal -= entry.byteSize;
        }
      }
      this.undoHistory.delete(key);
      return true;
    }
    return false;
  }

  private dropOldestUndoEntryForPath(resolvedPath: string): boolean {
    const stack = this.undoHistory.get(resolvedPath);
    if (!stack || stack.length <= 1) return false;

    const lastIndex = stack.length - 1;
    const index = stack.slice(0, lastIndex).findIndex((entry) => entry.byteSize > 0);
    if (index === -1) return false;
    const [removed] = stack.splice(index, 1);
    this.undoBytesTotal -= removed.byteSize;
    return true;
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
