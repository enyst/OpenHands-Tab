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
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('times out long-running commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new TerminalTool();
    const start = Date.now();
    const result = await tool.execute(tool.validate({ command: 'sleep 2', timeoutMs: 200 }), { workspace });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('FileEditorTool', () => {
  it('writes content', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();
    const args = tool.validate({ path: 'note.txt', content: 'first line' });
    const result = await tool.execute(args, { workspace });
    expect(result.bytesWritten).toBeGreaterThan(0);
    const saved = await workspace.readFile('note.txt');
    expect(saved).toContain('first line');
  });
});

describe('TaskTrackerTool', () => {
  it('creates and completes tasks', async () => {
    const tool = new TaskTrackerTool();
    const createdTasks = await tool.execute(tool.validate({ action: 'create', title: 'Do work' }), {
      workspace: new LocalWorkspace(process.cwd()),
    });
    expect(createdTasks.tasks).toHaveLength(1);
    const taskId = createdTasks.tasks[0].id;

    const updated = await tool.execute(tool.validate({ action: 'complete', id: taskId }), {
      workspace: new LocalWorkspace(process.cwd()),
    });
    expect(updated.tasks[0].completed).toBe(true);
  });
});

describe('BrowserTool', () => {
  it('rejects unsupported protocols', async () => {
    const tool = new BrowserTool();
    expect(() => tool.validate({ url: 'file:///etc/passwd' })).toThrowError();
  });
});
