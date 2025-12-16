import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { BrowserTool, FileEditorTool, TaskTrackerTool, TerminalTool } from '..';
import { LocalWorkspace } from '../../workspace';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-tools-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('TerminalTool', () => {
  it('executes a simple command', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();
    const result = await tool.execute(tool.validate({ command: 'echo hello' }), { workspace });
    expect(result.exit_code).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('hello');
  });

  it('times out long-running commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();
    const start = Date.now();
    const result = await tool.execute(tool.validate({ command: 'sleep 2', timeout: 0.2 }), { workspace });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.exit_code).not.toBe(0);
  });
});

describe('FileEditorTool', () => {
  it('writes content', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();
    const args = tool.validate({ command: 'create', path: 'note.txt', file_text: 'first line' });
    const result = await tool.execute(args, { workspace });
    expect(result.command).toBe('create');
    const saved = await workspace.readFile('note.txt');
    expect(saved).toContain('first line');
  });

  it('views files with line numbers and truncation', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const longContent = Array.from({ length: 2000 }, (_, i) => `line-${i + 1}`).join('\n');
    const createArgs = tool.validate({ command: 'create', path: 'note.txt', file_text: longContent });
    await tool.execute(createArgs, { workspace });

    const viewArgs = tool.validate({ command: 'view', path: 'note.txt', view_range: [1, -1] });
    const viewResult = await tool.execute(viewArgs, { workspace });

    expect(viewResult.command).toBe('view');
    expect(viewResult.new_content).toBeDefined();
    const viewed = viewResult.new_content ?? '';

    // Starts with cat -n style numbering
    expect(viewed.startsWith('1\tline-1')).toBe(true);

    // Truncation marker present for long content
    expect(viewed).toContain('<response clipped>');

    const parts = viewed.split('\n<response clipped>\n');
    expect(parts.length).toBe(2);
    const [head, tail] = parts;
    expect(head.length).toBeLessThanOrEqual(500 + 20); // small slop for line boundaries
    expect(tail.length).toBeLessThanOrEqual(500 + 20);
  });

  it('supports undo_edit for edits', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'v0' }), { workspace });
    await tool.execute(tool.validate({ command: 'str_replace', path: 'note.txt', old_str: 'v0', new_str: 'v1' }), { workspace });

    const undo = await tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace });
    expect(undo.command).toBe('undo_edit');
    expect(undo.prev_exist).toBe(true);
    expect(await workspace.readFile('note.txt')).toBe('v0');
  });

  it('supports multiple undo_edit calls', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'v0' }), { workspace });
    await tool.execute(tool.validate({ command: 'str_replace', path: 'note.txt', old_str: 'v0', new_str: 'v1' }), { workspace });
    await tool.execute(tool.validate({ command: 'str_replace', path: 'note.txt', old_str: 'v1', new_str: 'v2' }), { workspace });

    await tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace });
    expect(await workspace.readFile('note.txt')).toBe('v1');

    await tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace });
    expect(await workspace.readFile('note.txt')).toBe('v0');
  });

  it('undo_edit can undo a create by deleting the file', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'content' }), { workspace });
    const undo = await tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace });
    expect(undo.prev_exist).toBe(false);
    await expect(workspace.readFile('note.txt')).rejects.toThrowError();
  });

  it('undo_edit refuses to delete directories when undoing a create', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'content' }), { workspace });
    await fs.promises.unlink(path.join(dir, 'note.txt'));
    await fs.promises.mkdir(path.join(dir, 'note.txt'));

    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace }))
      .rejects.toThrowError(/refusing to delete directory/i);
    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace }))
      .rejects.toThrowError(/refusing to delete directory/i);
    expect(fs.statSync(path.join(dir, 'note.txt')).isDirectory()).toBe(true);
  });

  it('caps undo_edit history per path', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'v0' }), { workspace });
    for (let i = 0; i < 11; i++) {
      await tool.execute(
        tool.validate({ command: 'str_replace', path: 'note.txt', old_str: `v${i}`, new_str: `v${i + 1}` }),
        { workspace },
      );
    }
    expect(await workspace.readFile('note.txt')).toBe('v11');

    for (let i = 0; i < 10; i++) {
      await tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace });
    }
    expect(await workspace.readFile('note.txt')).toBe('v1');

    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace }))
      .rejects.toThrowError(/no edit history/i);
  });

  it('throws undo_edit when there is no history', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await workspace.writeFile('note.txt', 'content');
    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'note.txt' }), { workspace }))
      .rejects.toThrowError(/no edit history/i);
  });
});

describe('TaskTrackerTool', () => {
  it('plans and views tasks', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TaskTrackerTool();
    const planned = await tool.execute(
      tool.validate({ command: 'plan', task_list: [{ title: 'Do work', status: 'todo' }] }),
      { workspace },
    );
    expect(planned.command).toBe('plan');

    const viewed = await tool.execute(tool.validate({ command: 'view' }), { workspace });
    expect(viewed.task_list.length).toBeGreaterThan(0);
    expect(viewed.task_list[0].title).toBe('Do work');
  });
});

describe('BrowserTool', () => {
  it('rejects unsupported protocols', async () => {
    const tool = new BrowserTool();
    expect(() => tool.validate({ url: 'file:///etc/passwd' })).toThrowError();
  });
});
