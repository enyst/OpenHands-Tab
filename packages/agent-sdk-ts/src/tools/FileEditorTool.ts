import path from 'path';
import type { ToolContext, ToolHandler } from './types';
import { requireBoolean, requireObject, requireString, optionalString } from './validation';

export interface FileEditorArgs {
  path: string;
  content: string;
  append?: boolean;
}

export interface FileEditorResult {
  path: string;
  bytesWritten: number;
}

export class FileEditorTool implements ToolHandler<FileEditorArgs, FileEditorResult> {
  readonly name = 'file_editor';

  validate(input: unknown): FileEditorArgs {
    const obj = requireObject(input, 'file editor args');
    const filePath = requireString(obj.path, 'path');
    const content = optionalString(obj.content, 'content') ?? '';
    const append = obj.append === undefined ? false : requireBoolean(obj.append, 'append');
    return { path: filePath, content, append };
  }

  async execute(args: FileEditorArgs, context: ToolContext): Promise<FileEditorResult> {
    const resolved = context.workspace.resolvePath(args.path);
    const dir = path.dirname(resolved);
    await context.workspace.ensureDirectory(dir);

    const writeMethod = args.append ? context.workspace.readFile(args.path).catch(() => '') : Promise.resolve('');
    const existing = await writeMethod;
    const newContent = args.append ? `${existing}${existing ? '\n' : ''}${args.content}` : args.content;
    await context.workspace.writeFile(args.path, newContent);

    return { path: resolved, bytesWritten: Buffer.byteLength(newContent) };
  }
}
