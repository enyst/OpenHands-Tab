import * as fs from 'fs/promises';
import * as path from 'path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFsError = (err: unknown): err is NodeJS.ErrnoException => isRecord(err) && typeof err.code === 'string';

export async function migrateWorkspaceConversationStore(params: {
  workspaceRoot: string;
  targetRoot: string;
  log?: (line: string) => void;
}): Promise<{ moved: number; skipped: number; legacyDir: string }> {
  const legacyDir = path.join(params.workspaceRoot, '.openhands', 'conversations');
  const log = params.log;

  try {
    const stat = await fs.stat(legacyDir);
    if (!stat.isDirectory()) return { moved: 0, skipped: 0, legacyDir };
  } catch (err) {
    if (isFsError(err) && err.code === 'ENOENT') return { moved: 0, skipped: 0, legacyDir };
    throw err;
  }

  await fs.mkdir(params.targetRoot, { recursive: true });

  const entries = await fs.readdir(legacyDir, { withFileTypes: true });
  let moved = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      skipped += 1;
      continue;
    }

    const from = path.join(legacyDir, entry.name);
    const baseTo = path.join(params.targetRoot, entry.name);
    const chooseDestination = async (): Promise<string> => {
      try {
        await fs.stat(baseTo);
        // Collision: keep both by choosing a unique destination.
        for (let i = 1; i < 1000; i += 1) {
          const candidate = `${baseTo}-migrated-${i}`;
          try {
            await fs.stat(candidate);
          } catch (err) {
            if (isFsError(err) && err.code === 'ENOENT') return candidate;
            throw err;
          }
        }
        return `${baseTo}-migrated-${Date.now()}`;
      } catch (err) {
        if (isFsError(err) && err.code === 'ENOENT') return baseTo;
        throw err;
      }
    };

    const to = await chooseDestination();
    try {
      await fs.rename(from, to);
    } catch (err) {
      if (isFsError(err) && err.code === 'EXDEV') {
        await fs.cp(from, to, { recursive: true });
        await fs.rm(from, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
    moved += 1;
  }

  try {
    const remaining = await fs.readdir(legacyDir);
    if (remaining.length === 0) {
      await fs.rmdir(legacyDir);
      log?.(`[storage] Migrated ${moved} conversation(s) from workspace legacy store to ${params.targetRoot}`);
    } else if (moved > 0) {
      log?.(`[storage] Migrated ${moved} conversation(s) from workspace legacy store to ${params.targetRoot} (legacy dir not empty)`);
    }
  } catch {
    // Best-effort cleanup/logging; ignore.
  }

  return { moved, skipped, legacyDir };
}
