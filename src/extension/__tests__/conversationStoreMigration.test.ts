import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { migrateWorkspaceConversationStore } from '../conversationStoreMigration';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('migrateWorkspaceConversationStore', () => {
  it('moves legacy workspace conversation dirs into the target root', async () => {
    const workspaceRoot = await makeTempDir('oh-tab-workspace-');
    const targetRoot = await makeTempDir('oh-tab-target-');
    const legacyDir = path.join(workspaceRoot, '.openhands', 'conversations');
    const legacyConv = path.join(legacyDir, 'local-abc123');

    await fs.mkdir(legacyConv, { recursive: true });
    await fs.writeFile(path.join(legacyConv, 'state.json'), '{"ok":true}\n', 'utf8');
    await fs.writeFile(path.join(legacyConv, 'events.jsonl'), '{"kind":"MessageEvent"}\n', 'utf8');

    const result = await migrateWorkspaceConversationStore({ workspaceRoot, targetRoot });
    expect(result.moved).toBe(1);
    expect(await fs.readFile(path.join(targetRoot, 'local-abc123', 'state.json'), 'utf8')).toContain('"ok":true');

    // Legacy dir should be removed when empty.
    await expect(fs.stat(legacyDir)).rejects.toThrow();
  });

  it('avoids collisions by picking a unique destination name', async () => {
    const workspaceRoot = await makeTempDir('oh-tab-workspace-');
    const targetRoot = await makeTempDir('oh-tab-target-');
    const legacyDir = path.join(workspaceRoot, '.openhands', 'conversations');

    await fs.mkdir(path.join(legacyDir, 'local-dup'), { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'local-dup', 'state.json'), '{"from":"legacy"}\n', 'utf8');

    await fs.mkdir(path.join(targetRoot, 'local-dup'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'local-dup', 'state.json'), '{"from":"target"}\n', 'utf8');

    const result = await migrateWorkspaceConversationStore({ workspaceRoot, targetRoot });
    expect(result.moved).toBe(1);

    const entries = await fs.readdir(targetRoot, { withFileTypes: true });
    const migrated = entries.filter((e) => e.isDirectory() && e.name.startsWith('local-dup-migrated-'));
    expect(migrated.length).toBe(1);
    expect(await fs.readFile(path.join(targetRoot, migrated[0]!.name, 'state.json'), 'utf8')).toContain('"legacy"');
  });
});

