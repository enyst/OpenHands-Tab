import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getPastedImagesDir, isValidPastedImageId } from './pastedImages';

export type PastedImageFileInfo = {
  imageId: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type PastedImagesCleanupResult = {
  deleted: number;
  freedBytes: number;
  totalFiles: number;
  totalBytes: number;
  remainingFiles: number;
  remainingBytes: number;
};

async function listPastedImageFiles(baseDir: string): Promise<PastedImageFileInfo[]> {
  const dir = getPastedImagesDir(baseDir);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files: PastedImageFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const imageId = entry.name;
    if (!isValidPastedImageId(imageId)) continue;

    const filePath = path.join(dir, imageId);
    try {
      const stat = await fs.stat(filePath);
      files.push({ imageId, filePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }

  return files;
}

export async function cleanupPastedImages(options: {
  baseDir: string;
  keepImageIds: ReadonlySet<string>;
  maxFiles: number;
  maxBytes: number;
  log?: (message: string) => void;
}): Promise<PastedImagesCleanupResult> {
  const log = options.log;
  const items = await listPastedImageFiles(options.baseDir);
  const totalFiles = items.length;
  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);

  let remainingFiles = totalFiles;
  let remainingBytes = totalBytes;
  let deleted = 0;
  let freedBytes = 0;

  if (remainingFiles <= options.maxFiles && remainingBytes <= options.maxBytes) {
    return { deleted, freedBytes, totalFiles, totalBytes, remainingFiles, remainingBytes };
  }

  const candidates = items
    .filter((item) => !options.keepImageIds.has(item.imageId))
    .sort((a, b) => {
      const byTime = a.mtimeMs - b.mtimeMs;
      if (byTime !== 0) return byTime;
      return a.imageId.localeCompare(b.imageId);
    });

  for (const item of candidates) {
    if (remainingFiles <= options.maxFiles && remainingBytes <= options.maxBytes) break;
    try {
      await fs.unlink(item.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    deleted += 1;
    freedBytes += item.sizeBytes;
    remainingFiles -= 1;
    remainingBytes -= item.sizeBytes;
  }

  if (deleted > 0) {
    log?.(`[pasted-images] Deleted ${deleted} old image(s) (freed ${freedBytes} bytes).`);
  }

  if (remainingFiles > options.maxFiles || remainingBytes > options.maxBytes) {
    log?.(`[pasted-images] Storage cap exceeded (files=${remainingFiles}/${options.maxFiles}, bytes=${remainingBytes}/${options.maxBytes}). All remaining images are protected by the active conversation.`);
  }

  return { deleted, freedBytes, totalFiles, totalBytes, remainingFiles, remainingBytes };
}
