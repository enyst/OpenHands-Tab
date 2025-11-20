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

    const [head, , tail] = viewed.split('\n<response clipped>\n');
    expect(head.length).toBeLessThanOrEqual(500 + 20); // small slop for line boundaries
    expect(tail.length).toBeLessThanOrEqual(500 + 20);
  });


describe('TaskTrackerTool', () => {
  it('plans and views tasks', async () => {
    const tool = new TaskTrackerTool();
    const ws = new LocalWorkspace(process.cwd());
    const planned = await tool.execute(tool.validate({ command: 'plan', task_list: [{ title: 'Do work', status: 'todo' }] }), {
      workspace: ws,
    });
    expect(planned.command).toBe('plan');

    const viewed = await tool.execute(tool.validate({ command: 'view' }), { workspace: ws });
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
