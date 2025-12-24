import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupPastedImages } from '../pastedImagesCleanup';
import { getPastedImagesDir } from '../pastedImages';

async function writeImage(baseDir: string, imageId: string, sizeBytes: number, mtimeMs: number): Promise<void> {
  const dir = getPastedImagesDir(baseDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, imageId), Buffer.alloc(sizeBytes, 0));
  const mtime = new Date(mtimeMs);
  await fs.utimes(path.join(dir, imageId), mtime, mtime);
}

describe('cleanupPastedImages', () => {
  let tmpDir = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-pasted-images-cleanup-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('deletes oldest files to satisfy maxFiles cap', async () => {
    await writeImage(tmpDir, '0000000000000001.png', 10, 1);
    await writeImage(tmpDir, '0000000000000002.png', 10, 2);
    await writeImage(tmpDir, '0000000000000003.png', 10, 3);

    await cleanupPastedImages({
      baseDir: tmpDir,
      keepImageIds: new Set(),
      maxFiles: 2,
      maxBytes: 10_000,
    });

    const remaining = (await fs.readdir(getPastedImagesDir(tmpDir))).sort();
    expect(remaining).toEqual(['0000000000000002.png', '0000000000000003.png']);
  });

  it('deletes oldest files to satisfy maxBytes cap', async () => {
    await writeImage(tmpDir, '0000000000000001.png', 50, 1);
    await writeImage(tmpDir, '0000000000000002.png', 50, 2);
    await writeImage(tmpDir, '0000000000000003.png', 50, 3);

    const result = await cleanupPastedImages({
      baseDir: tmpDir,
      keepImageIds: new Set(),
      maxFiles: 10,
      maxBytes: 100,
    });

    expect(result.deleted).toBe(1);
    expect(result.remainingBytes).toBe(100);
    const remaining = (await fs.readdir(getPastedImagesDir(tmpDir))).sort();
    expect(remaining).toEqual(['0000000000000002.png', '0000000000000003.png']);
  });

  it('never deletes protected image ids', async () => {
    await writeImage(tmpDir, '0000000000000001.png', 10, 1);
    await writeImage(tmpDir, '0000000000000002.png', 10, 2);
    await writeImage(tmpDir, '0000000000000003.png', 10, 3);

    const keep = new Set(['0000000000000001.png']);

    await cleanupPastedImages({
      baseDir: tmpDir,
      keepImageIds: keep,
      maxFiles: 1,
      maxBytes: 10_000,
    });

    const remaining = await fs.readdir(getPastedImagesDir(tmpDir));
    expect(remaining).toEqual(['0000000000000001.png']);
  });

  it('logs when caps cannot be met due to protected images', async () => {
    await writeImage(tmpDir, '0000000000000001.png', 10, 1);
    await writeImage(tmpDir, '0000000000000002.png', 10, 2);

    const logs: string[] = [];
    const keep = new Set(['0000000000000001.png', '0000000000000002.png']);

    const result = await cleanupPastedImages({
      baseDir: tmpDir,
      keepImageIds: keep,
      maxFiles: 0,
      maxBytes: 0,
      log: (line) => logs.push(line),
    });

    expect(result.deleted).toBe(0);
    expect(logs.some((line) => line.includes('Storage cap exceeded'))).toBe(true);
  });
});
