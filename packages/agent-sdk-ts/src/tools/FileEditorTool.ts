import fs from 'fs/promises';
import path from 'path';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';
import type { FileEditorResult } from './fileEditor/shared';
import {
  IMAGE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_OUTPUT_CHARS,
  PDF_EXTENSION,
} from './fileEditor/shared';
import { fileEditorSchema, type FileEditorArgs, TOOL_DESCRIPTION } from './fileEditor/schema';
import { addLineNumbers, applyViewRange, isProbablyBinary, truncateContent } from './fileEditor/textTransforms';
import { UndoHistoryManager, exceedsUndoHistorySizeCap } from './fileEditor/undoHistory';
import { isBinaryExtension, viewDirectory, viewImage } from './fileEditor/viewHandlers';

export type { FileEditorResult } from './fileEditor/shared';
export { MAX_OUTPUT_CHARS, OUTPUT_CLIP_MARKER } from './fileEditor/shared';

export class FileEditorTool extends ZodTool<FileEditorArgs, FileEditorResult> {
  readonly name = 'file_editor';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = fileEditorSchema;
  private readonly undoHistory = new UndoHistoryManager();
  private readonly maxOutputChars: number;

  override getEnhancedDescription(workspaceRoot: string): string {
    return `${TOOL_DESCRIPTION}\n\nYour current working directory is: ${workspaceRoot}\nWhen exploring project structure, start with this directory instead of the root filesystem.`;
  }

  constructor(options: { maxOutputChars?: number } = {}) {
    super();
    const configured = options.maxOutputChars;
    this.maxOutputChars =
      typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : MAX_OUTPUT_CHARS;
  }

  private async pathExists(absPath: string): Promise<boolean> {
    try {
      await fs.stat(absPath);
      return true;
    } catch {
      return false;
    }
  }

  async execute(args: FileEditorArgs, context: ToolContext): Promise<FileEditorResult> {
    const ws = context.workspace;
    const resolved = ws.resolvePath(args.path);
    const extension = path.extname(resolved).toLowerCase();

    switch (args.command) {
      case 'view': {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          const { text } = await viewDirectory(resolved, ws, this.maxOutputChars);
          return { command: 'view', path: resolved, prev_exist: true, old_content: null, new_content: text };
        }
        const buffer = await this.readValidatedFile(resolved, extension, ws);
        if (IMAGE_EXTENSIONS.has(extension)) {
          return viewImage(resolved, extension, buffer);
        }
        const content = buffer.toString('utf8');
        const ranged = applyViewRange(content, args.view_range);
        const numbered = addLineNumbers(ranged);
        const truncated = truncateContent(numbered, this.maxOutputChars);
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
        this.undoHistory.push(resolved, { prevExist: false, oldContent: null, byteSize: 0 });
        return {
          command: 'create',
          path: resolved,
          prev_exist: false,
          old_content: null,
          new_content: truncateContent(fileText, this.maxOutputChars),
        };
      }
      case 'str_replace': {
        if (IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION) {
          throw new Error(`str_replace failed: refusing to edit binary file type: ${extension}`);
        }
        const buffer = await this.readValidatedFile(resolved, extension, ws);
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
        if (exceedsUndoHistorySizeCap(undoByteSize)) {
          throw new Error('str_replace failed: undo snapshot exceeds total undo history size cap');
        }
        await ws.writeFile(resolved, updated);
        this.undoHistory.push(resolved, { prevExist: true, oldContent: prev, byteSize: undoByteSize });
        return { command: 'str_replace', path: resolved, prev_exist: true, old_content: prev, new_content: updated };
      }
      case 'insert': {
        if (IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION) {
          throw new Error(`insert failed: refusing to edit binary file type: ${extension}`);
        }
        const buffer = await this.readValidatedFile(resolved, extension, ws);
        const prev = buffer.toString('utf8');
        const lines = prev.split(/\r?\n/);
        const insertion = args.new_str ?? '';
        const index = Math.min(args.insert_line ?? 0, lines.length);
        lines.splice(index, 0, insertion);
        const updated = lines.join('\n');
        const undoByteSize = Math.max(buffer.length, prev.length * 2);
        if (exceedsUndoHistorySizeCap(undoByteSize)) {
          throw new Error('insert failed: undo snapshot exceeds total undo history size cap');
        }
        await ws.writeFile(resolved, updated);
        this.undoHistory.push(resolved, { prevExist: true, oldContent: prev, byteSize: undoByteSize });
        return { command: 'insert', path: resolved, prev_exist: true, old_content: prev, new_content: updated };
      }
      case 'undo_edit': {
        const current = await this.readOptionalFile(resolved, ws);
        const undo = this.undoHistory.peek(resolved);
        if (!undo) {
          throw new Error('undo_edit failed: no edit history for path');
        }

        if (!undo.prevExist) {
          await this.removeCreatedFile(resolved);
        } else {
          await ws.writeFile(resolved, undo.oldContent ?? '');
        }
        this.undoHistory.discardLatest(resolved);

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

  private async readValidatedFile(absPath: string, extension: string, workspace: ToolContext['workspace']): Promise<Buffer> {
    const buffer = await workspace.readFileBytes(absPath, { maxBytes: MAX_FILE_SIZE_BYTES });
    if (!isBinaryExtension(extension) && isProbablyBinary(buffer)) {
      throw new Error('File appears to be binary and this file type cannot be read or edited by this tool.');
    }
    return buffer;
  }

  private async readOptionalFile(absPath: string, workspace: ToolContext['workspace']): Promise<string | null> {
    try {
      return await workspace.readFile(absPath, 'utf8');
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
