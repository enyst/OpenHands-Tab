import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BrowserNavigateTool,
  DelegateTool,
  GlobTool,
  GrepTool,
  PlanningFileEditorTool,
  ZodTool,
} from '..';
import { LocalWorkspace } from '../../workspace';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-new-tools-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('BrowserUse toolset', () => {
  it('validates and executes browser navigation', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new BrowserNavigateTool();
    const args = tool.validate({ url: 'https://example.com' });
    expect(args.new_tab).toBe(false);
    const result = await tool.execute(args, { workspace });
    expect(result.action).toBe('browser_navigate');
    expect(result.request.url).toBe('https://example.com');
  });
});

describe('DelegateTool', () => {
  it('requires ids for spawn and executes delegation', async () => {
    const tool = new DelegateTool();
    expect(() => tool.validate({ command: 'spawn' })).toThrow();
    const args = tool.validate({ command: 'delegate', tasks: { child: 'do work' } });
    const result = await tool.execute(args, { workspace: new LocalWorkspace(process.cwd()) });
    expect(result.command).toBe('delegate');
    expect(result.detail.tasks).toEqual({ child: 'do work' });
  });
});

describe('GlobTool', () => {
  it('finds files matching pattern', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await workspace.writeFile('notes/todo.txt', 'task');
    await workspace.writeFile('src/index.ts', '// code');
    const tool = new GlobTool();
    const args = tool.validate({ pattern: '**/*.txt' });
    const result = await tool.execute(args, { workspace });
    expect(result.files.some((file) => file.endsWith('todo.txt'))).toBe(true);
    expect(result.pattern).toBe('**/*.txt');
  });

  it('supports brace expansion in patterns', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await workspace.writeFile('config/app.json', '{}');
    await workspace.writeFile('config/app.yaml', '---');
    const tool = new GlobTool();
    const args = tool.validate({ pattern: '**/*.{json,yaml}' });
    const result = await tool.execute(args, { workspace });
    expect(result.files.filter((file) => file.endsWith('.json') || file.endsWith('.yaml')).length).toBe(2);
  });
});

describe('GrepTool', () => {
  it('returns matches using regex content search', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await workspace.writeFile('README.md', 'find this needle');
    await workspace.writeFile('IGNORE.md', 'no match here');
    const tool = new GrepTool();
    const args = tool.validate({ pattern: 'needle', include: '*.md' });
    const result = await tool.execute(args, { workspace });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((file) => file.endsWith('README.md'))).toBe(true);
  });

  it('honors brace expansion for include filters', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await workspace.writeFile('README.md', 'match me');
    await workspace.writeFile('config/app.yaml', 'match me too');
    const tool = new GrepTool();
    const args = tool.validate({ pattern: 'match', include: '**/*.{md,yaml}' });
    const result = await tool.execute(args, { workspace });
    expect(result.matches.some((file) => file.endsWith('README.md'))).toBe(true);
    expect(result.matches.some((file) => file.endsWith('app.yaml'))).toBe(true);
  });
});

describe('PlanningFileEditorTool', () => {
  it('enforces PLAN.md edits and performs create/replace', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new PlanningFileEditorTool();
    expect(() => tool.validate({ command: 'create', path: 'PLAN.md' })).toThrow();
    const createArgs = tool.validate({ command: 'create', path: 'PLAN.md', file_text: 'Initial plan' });
    await tool.execute(createArgs, { workspace });
    const replaceArgs = tool.validate({
      command: 'str_replace',
      path: 'PLAN.md',
      old_str: 'Initial',
      new_str: 'Updated',
    });
    const replaced = await tool.execute(replaceArgs, { workspace });
    expect(replaced.new_content ?? '').toContain('Updated plan');
    const viewArgs = tool.validate({ command: 'view', path: 'PLAN.md', view_range: [1, -1] });
    const view = await tool.execute(viewArgs, { workspace });
    expect(view.new_content ?? '').toContain('Updated plan');
  });

  it('rejects edits to non-plan files', async () => {
    const tool = new PlanningFileEditorTool();
    const args = tool.validate({ command: 'create', path: 'PLAN.md', file_text: 'ok' });
    const workspace = new LocalWorkspace(process.cwd());
    await expect(tool.execute({ ...args, path: 'README.md' }, { workspace })).rejects.toThrow();
  });

  it('throws when str_replace target is not unique', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new PlanningFileEditorTool();
    const createArgs = tool.validate({ command: 'create', path: 'PLAN.md', file_text: 'repeat repeat' });
    await tool.execute(createArgs, { workspace });
    const replaceArgs = tool.validate({
      command: 'str_replace',
      path: 'PLAN.md',
      old_str: 'repeat',
      new_str: 'swap',
    });
    await expect(tool.execute(replaceArgs, { workspace })).rejects.toThrow(
      /old_str is not unique and matches multiple locations/,
    );
  });

  it('treats overlapping str_replace matches as non-unique', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new PlanningFileEditorTool();
    const createArgs = tool.validate({ command: 'create', path: 'PLAN.md', file_text: 'aaaa' });
    await tool.execute(createArgs, { workspace });
    const replaceArgs = tool.validate({ command: 'str_replace', path: 'PLAN.md', old_str: 'aa', new_str: 'bb' });
    await expect(tool.execute(replaceArgs, { workspace })).rejects.toThrow(/old_str is not unique/);
  });

  it('views PLAN.md with line numbers and truncation', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new PlanningFileEditorTool();

    const longContent = Array.from({ length: 2000 }, (_, i) => `plan-line-${i + 1}`).join('\n');
    const createArgs = tool.validate({ command: 'create', path: 'PLAN.md', file_text: longContent });
    await tool.execute(createArgs, { workspace });

    const viewArgs = tool.validate({ command: 'view', path: 'PLAN.md', view_range: [1, -1] });
    const view = await tool.execute(viewArgs, { workspace });

    expect(view.command).toBe('view');
    expect(view.new_content).toBeDefined();
    const viewed = view.new_content ?? '';

    // Starts with cat -n style numbering
    expect(viewed.startsWith('1\tplan-line-1')).toBe(true);

    // Truncation marker present for long content
    expect(viewed).toContain('<response clipped>');
    expect(viewed.length).toBeLessThanOrEqual(8_000);

    const parts = viewed.split('\n<response clipped>\n');
    expect(parts.length).toBe(2);
    const [head, tail] = parts;
    const maxChars = 8_000;
    const clipMarker = '<response clipped>';
    const half = Math.floor((maxChars - clipMarker.length - 2) / 2);
    expect(head.length).toBeLessThanOrEqual(half);
    expect(tail.length).toBeLessThanOrEqual(half);
  });

  it('rejects create when file already exists', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new PlanningFileEditorTool();
    const createArgs = tool.validate({ command: 'create', path: 'PLAN.md', file_text: 'initial' });
    await tool.execute(createArgs, { workspace });
    await expect(tool.execute(createArgs, { workspace })).rejects.toThrow(/already exists/);
  });
});

describe('ZodTool parameter conversion', () => {
  const demoSchema = z.object({ greeting: z.string().describe('A greeting message.') });

  class DemoTool extends ZodTool<z.infer<typeof demoSchema>, { ok: boolean }> {
    readonly name = 'demo';
    readonly description = 'demo tool';
    readonly schema = demoSchema;

    async execute(): Promise<{ ok: boolean }> {
      return { ok: true };
    }
  }

  it('produces JSON Schema parameters from zod definitions', () => {
    const tool = new DemoTool();
    const definition = tool.getToolDefinition();
    expect(definition.function.parameters).toMatchObject({
      type: 'object',
      properties: {
        greeting: { type: 'string', description: 'A greeting message.' },
      },
      required: ['greeting'],
    });
  });
});
