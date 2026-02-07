import path from 'path';
import type { ToolContext } from '../types';
import type { FileEditorResult } from './shared';
import { IMAGE_EXTENSIONS, MAX_INLINE_IMAGE_BASE64_CHARS, PDF_EXTENSION } from './shared';
import { truncateContent } from './textTransforms';

type Workspace = ToolContext['workspace'];
type WorkspaceListEntry = Awaited<ReturnType<Workspace['list']>>[number];
type VisibleEntry = { name: string; abs: string; isDir: boolean };

const getSortedVisibleEntries = (entries: WorkspaceListEntry[]): VisibleEntry[] =>
  entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({ name: entry.name, abs: entry.path, isDir: entry.isDirectory }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const viewDirectory = async (
  absPath: string,
  workspace: Workspace,
  maxOutputChars: number,
): Promise<{ text: string }> => {
  const workspaceRoot = workspace.root;
  const toDisplayPath = (absolutePath: string): string => {
    const relative = path.relative(workspaceRoot, absolutePath);
    if (!relative || relative === '') return '.';
    if (relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath;
    return relative;
  };

  const topEntries = await workspace.list(absPath);
  const hiddenCount = topEntries.filter((entry) => entry.name.startsWith('.')).length;
  const visibleTop = getSortedVisibleEntries(topEntries);

  const displayRoot = toDisplayPath(absPath);
  const lines: string[] = [`d ${displayRoot}`];

  for (const entry of visibleTop) {
    const displayEntry = toDisplayPath(entry.abs);
    lines.push(`${entry.isDir ? 'd' : 'f'} ${displayEntry}`);
    if (!entry.isDir) continue;

    let childEntries: Awaited<ReturnType<Workspace['list']>>;
    try {
      childEntries = await workspace.list(entry.abs);
    } catch {
      lines.push(`skipped unreadable: ${displayEntry}`);
      continue;
    }
    const visibleChildren = getSortedVisibleEntries(childEntries);
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
  return { text: truncateContent(`${header}${body}${hiddenNote}`, maxOutputChars) };
};

export const viewImage = (absPath: string, extension: string, buffer: Buffer): FileEditorResult => {
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
};

export const isBinaryExtension = (extension: string): boolean =>
  IMAGE_EXTENSIONS.has(extension) || extension === PDF_EXTENSION;
