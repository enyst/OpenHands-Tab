import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplyPatchTool } from '..';
import { LocalWorkspace } from '../../workspace';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-apply-patch-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('ApplyPatchTool', () => {
  it('adds a file', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    const tool = new ApplyPatchTool();
    const patch = [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello',
      '+World',
      '*** End Patch',
    ].join('\n');

    const result = await tool.execute(tool.validate({ patch }), { workspace });
    expect(result.message).toBe('Done!');
    expect(result.fuzz).toBe(0);
    expect(result.commit.changes['hello.txt']?.type).toBe('add');
    expect(await workspace.readFile('hello.txt')).toBe('Hello\nWorld');
  });

  it('updates a file', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await workspace.writeFile('note.txt', 'a\nb\nc');

    const tool = new ApplyPatchTool();
    const patch = [
      '*** Begin Patch',
      '*** Update File: note.txt',
      '@@',
      '-b',
      '+B',
      '*** End Patch',
    ].join('\n');

    const result = await tool.execute(tool.validate({ patch }), { workspace });
    expect(result.message).toBe('Done!');
    expect(result.fuzz).toBe(0);
    expect(result.commit.changes['note.txt']?.type).toBe('update');
    expect(await workspace.readFile('note.txt')).toBe('a\nB\nc');
  });

  it('deletes a file', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await workspace.writeFile('gone.txt', 'bye');

    const tool = new ApplyPatchTool();
    const patch = [
      '*** Begin Patch',
      '*** Delete File: gone.txt',
      '*** End Patch',
    ].join('\n');

    const result = await tool.execute(tool.validate({ patch }), { workspace });
    expect(result.message).toBe('Done!');
    expect(result.fuzz).toBe(0);
    expect(result.commit.changes['gone.txt']?.type).toBe('delete');
    await expect(workspace.readFile('gone.txt')).rejects.toThrow();
  });

  it('moves a file during update', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await workspace.writeFile('old.txt', 'one\ntwo');

    const tool = new ApplyPatchTool();
    const patch = [
      '*** Begin Patch',
      '*** Update File: old.txt',
      '*** Move to: new.txt',
      '@@',
      '-two',
      '+TWO',
      '*** End Patch',
    ].join('\n');

    const result = await tool.execute(tool.validate({ patch }), { workspace });
    expect(result.message).toBe('Done!');
    expect(result.fuzz).toBe(0);
    expect(result.commit.changes['old.txt']?.type).toBe('update');
    expect(result.commit.changes['old.txt']?.move_path).toBe('new.txt');
    await expect(workspace.readFile('old.txt')).rejects.toThrow();
    expect(await workspace.readFile('new.txt')).toBe('one\nTWO');
  });

  it('rejects invalid patch text', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    const tool = new ApplyPatchTool();
    await expect(tool.execute(tool.validate({ patch: 'nope' }), { workspace })).rejects.toThrow('Invalid patch text');
  });

  it('rejects escaping paths', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    const tool = new ApplyPatchTool();
    const patch = [
      '*** Begin Patch',
      '*** Add File: ../escape.txt',
      '+nope',
      '*** End Patch',
    ].join('\n');

    await expect(tool.execute(tool.validate({ patch }), { workspace })).rejects.toThrow(
      'Absolute or escaping paths are not allowed',
    );
  });
});
