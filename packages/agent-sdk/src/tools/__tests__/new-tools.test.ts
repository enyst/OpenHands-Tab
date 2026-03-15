import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BrowserClickTool,
  BrowserCloseTabTool,
  BrowserGetContentTool,
  BrowserGetStateTool,
  BrowserListTabsTool,
  BrowserNavigateTool,
  BrowserSwitchTabTool,
  DelegateTool,
  GlobTool,
  GrepTool,
  OUTPUT_CLIP_MARKER,
  PlanningFileEditorTool,
  ZodTool,
} from '..';
import { LocalWorkspace } from '../../workspace';
import type { OpenHandsSettings } from '../../sdk/types/settings';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-sdk-new-tools-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];
const previousAgentBrowserBin = process.env.SMOLPAWS_AGENT_BROWSER_BIN;

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
  if (previousAgentBrowserBin === undefined) {
    delete process.env.SMOLPAWS_AGENT_BROWSER_BIN;
  } else {
    process.env.SMOLPAWS_AGENT_BROWSER_BIN = previousAgentBrowserBin;
  }
});

describe('BrowserUse toolset', () => {
  const createFakeAgentBrowser = async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-browser-stub-'));
    created.push(dir);
    const scriptPath = path.join(dir, 'agent-browser-stub.js');
    const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'snapshot' && args[1] === '-i') {
  process.stdout.write('button Save @e1\\ntextbox Name @e2\\nlink Docs @e3\\n');
} else if (args[0] === 'snapshot' && args[1] === '-c') {
  process.stdout.write('compact snapshot output with links and content');
} else if (args[0] === 'screenshot') {
  process.stdout.write('/tmp/agent-browser-shot.png');
} else if (args[0] === 'click') {
  process.stdout.write('clicked ' + args[1]);
} else if (args[0] === 'fill') {
  process.stdout.write('filled ' + args[1] + ' ' + args.slice(2).join(' '));
} else if (args[0] === 'open') {
  process.stdout.write('opened ' + args[1]);
} else if (args[0] === 'get' && args[1] === 'title') {
  process.stdout.write('Example title');
} else if (args[0] === 'get' && args[1] === 'url') {
  process.stdout.write('https://example.com/current');
} else if (args[0] === 'scroll') {
  process.stdout.write('scrolled ' + args[1] + ' ' + args[2]);
} else if (args[0] === 'back') {
  process.stdout.write('went back');
} else {
  process.stdout.write(args.join(' '));
}
`;
    await fs.promises.writeFile(scriptPath, script, 'utf8');
    await fs.promises.chmod(scriptPath, 0o755);
    process.env.SMOLPAWS_AGENT_BROWSER_BIN = scriptPath;
  };

  const createSlowAgentBrowser = async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-browser-slow-'));
    created.push(dir);
    const scriptPath = path.join(dir, 'agent-browser-slow.js');
    const script = `#!/usr/bin/env node
setTimeout(() => {
  process.stdout.write('finished late');
}, 35_000);
`;
    await fs.promises.writeFile(scriptPath, script, 'utf8');
    await fs.promises.chmod(scriptPath, 0o755);
    process.env.SMOLPAWS_AGENT_BROWSER_BIN = scriptPath;
  };

  const createWarningAgentBrowser = async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-browser-warning-'));
    created.push(dir);
    const scriptPath = path.join(dir, 'agent-browser-warning.js');
    const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'snapshot' && args[1] === '-i') {
  process.stdout.write('button Save @e1\\ntextbox Name @e2\\n');
  process.stderr.write('warning: skipped stale ref @e999\\n');
} else {
  process.stdout.write(args.join(' '));
}
`;
    await fs.promises.writeFile(scriptPath, script, 'utf8');
    await fs.promises.chmod(scriptPath, 0o755);
    process.env.SMOLPAWS_AGENT_BROWSER_BIN = scriptPath;
  };

  it('validates and executes browser navigation', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const tool = new BrowserNavigateTool();
    const args = tool.validate({ url: 'https://example.com' });
    expect(args.new_tab).toBe(false);
    const result = await tool.execute(args, { workspace });
    expect(result.action).toBe('browser_navigate');
    expect(result.request.url).toBe('https://example.com');
    expect(result.output).toContain('opened https://example.com');
  }, 15000);

  it('maps browser interaction indices through the latest snapshot refs', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const stateTool = new BrowserGetStateTool();
    const clickTool = new BrowserClickTool();
    const getContentTool = new BrowserGetContentTool();

    const stateResult = await stateTool.execute(stateTool.validate({ include_screenshot: true }), { workspace });
    expect(stateResult.refs).toEqual(['@e1', '@e2', '@e3']);
    expect(stateResult.output).toContain('/tmp/agent-browser-shot.png');

    const clickResult = await clickTool.execute(clickTool.validate({ index: 1 }), { workspace });
    expect(clickResult.output).toContain('clicked @e2');

    const contentResult = await getContentTool.execute(
      getContentTool.validate({ extract_links: true, start_from_char: 8 }),
      { workspace },
    );
    expect(contentResult.output).toBe('snapshot output with links and content');
    expect(contentResult.note).toContain('extract_links is accepted for compatibility');
  }, 15000);

  it('returns a synthetic single-tab listing for the local agent-browser path', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const tool = new BrowserListTabsTool();
    const result = await tool.execute(tool.validate({}), { workspace });
    expect(result.output).toContain('"tab_id": "current"');
    expect(result.output).toContain('https://example.com/current');
    expect(result.note).toContain('single active browser session');
  }, 15000);

  it('fails browser_click when refs are not cached yet', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const clickTool = new BrowserClickTool();
    await expect(clickTool.execute(clickTool.validate({ index: 0 }), { workspace })).rejects.toThrow(
      /Call browser_get_state before browser interactions/,
    );
  }, 15000);

  it('parses cached refs from snapshot stdout only', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createWarningAgentBrowser();
    const stateTool = new BrowserGetStateTool();
    const clickTool = new BrowserClickTool();

    const stateResult = await stateTool.execute(stateTool.validate({ include_screenshot: false }), { workspace });
    expect(stateResult.refs).toEqual(['@e1', '@e2']);
    expect(stateResult.output).toContain('warning: skipped stale ref @e999');

    await expect(clickTool.execute(clickTool.validate({ index: 2 }), { workspace })).rejects.toThrow(
      /Call browser_get_state before browser interactions/,
    );
  }, 15000);

  it('invalidates cached refs after page-changing navigation', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const stateTool = new BrowserGetStateTool();
    const navigateTool = new BrowserNavigateTool();
    const clickTool = new BrowserClickTool();

    await stateTool.execute(stateTool.validate({ include_screenshot: false }), { workspace });
    await navigateTool.execute(navigateTool.validate({ url: 'https://example.com/next' }), { workspace });

    await expect(clickTool.execute(clickTool.validate({ index: 0 }), { workspace })).rejects.toThrow(
      /Call browser_get_state before browser interactions/,
    );
  }, 15000);

  it('fails explicitly for unsupported tab actions', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createFakeAgentBrowser();
    const switchTabTool = new BrowserSwitchTabTool();
    const closeTabTool = new BrowserCloseTabTool();

    await expect(switchTabTool.execute(switchTabTool.validate({ tab_id: 'abcd' }), { workspace })).rejects.toThrow(
      /not supported/,
    );
    await expect(closeTabTool.execute(closeTabTool.validate({ tab_id: 'abcd' }), { workspace })).rejects.toThrow(
      /not supported/,
    );
  }, 15000);

  it('times out hung agent-browser commands', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    await createSlowAgentBrowser();
    const tool = new BrowserNavigateTool();
    await expect(tool.execute(tool.validate({ url: 'https://example.com' }), { workspace })).rejects.toThrow(
      /timed out after 30s/,
    );
  }, 40000);
});

describe('DelegateTool', () => {
  it('requires ids for spawn and executes delegation', async () => {
    const baseSettings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 5 },
      confirmation: {},
      secrets: {},
    };
    const tool = new DelegateTool();
    expect(() => tool.validate({ command: 'spawn' })).toThrow();
    const spawnArgs = tool.validate({ command: 'spawn', ids: ['child'] });
    const spawnResult = await tool.execute(spawnArgs, { workspace: new LocalWorkspace(process.cwd()), settings: baseSettings });
    expect(spawnResult.command).toBe('spawn');
    expect(spawnResult.ok).toBe(true);

    const delegateArgs = tool.validate({ command: 'delegate', tasks: { missing: 'do work' } });
    const delegateResult = await tool.execute(delegateArgs, { workspace: new LocalWorkspace(process.cwd()), settings: baseSettings });
    expect(delegateResult.command).toBe('delegate');
    expect(delegateResult.ok).toBe(false);
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
    const maxOutputChars = 2_000;
    const tool = new PlanningFileEditorTool({ maxOutputChars });

    const longContent = Array.from({ length: 500 }, (_, i) => `plan-line-${i + 1} ${'x'.repeat(20)}`).join('\n');
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
    expect(viewed).toContain(OUTPUT_CLIP_MARKER);
    expect(viewed.length).toBeLessThanOrEqual(maxOutputChars);

    const parts = viewed.split(`\n${OUTPUT_CLIP_MARKER}\n`);
    expect(parts.length).toBe(2);
    const [head, tail] = parts;
    const half = Math.floor((maxOutputChars - OUTPUT_CLIP_MARKER.length - 2) / 2);
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
