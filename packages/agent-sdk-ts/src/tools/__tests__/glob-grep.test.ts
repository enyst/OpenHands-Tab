import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobTool, GrepTool } from '..';
import { LocalWorkspace } from '../../workspace';

const makeWorkspace = async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-tools-glob-'));
  return { dir, workspace: new LocalWorkspace(dir) };
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

describe('GlobTool', () => {
  it('finds matching files recursively', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    const files = [
      'test.py',
      'main.js',
      'config.json',
      'src/app.py',
      'src/utils.js',
      'tests/test_main.py',
    ];

    for (const rel of files) {
      const full = path.join(dir, rel);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, `# Content of ${rel}`, 'utf8');
    }

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '**/*.py' }), { workspace });
    const realDir = await fs.promises.realpath(dir);

    expect(result.pattern).toBe('**/*.py');
    expect(result.searchPath).toBe(realDir);
    expect(result.truncated).toBe(false);
    expect(result.files.length).toBe(3);
    expect(result.files.every((p) => p.endsWith('.py') && fs.existsSync(p))).toBe(true);
  });

  it('treats patterns without slashes as recursive', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'app.py'), '# App', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'src/utils.py'), '# Utils', 'utf8');

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '*' }), { workspace });
    expect(result.files.length).toBe(1);
    expect(path.basename(result.files[0])).toBe('app.py');
  });

  it('supports restricting search to a directory', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'src/app.py'), '# App', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'src/utils.py'), '# Utils', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'tests/test_app.py'), '# Test', 'utf8');

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '*.py', path: 'src' }), { workspace });
    expect(result.files.length).toBe(2);
    expect(result.files.every((p) => p.endsWith('.py') && p.includes(`${path.sep}src${path.sep}`))).toBe(true);
  });

  it('truncates to 100 results', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    for (let i = 0; i < 150; i++) {
      const name = `file_${i.toString().padStart(3, '0')}.txt`;
      await fs.promises.writeFile(path.join(dir, name), `Content ${i}`, 'utf8');
    }

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '*.txt' }), { workspace });
    expect(result.truncated).toBe(true);
    expect(result.files.length).toBe(100);
  });

  it('supports absolute path patterns (extracts search root)', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'a.py'), '# A', 'utf8');
    await fs.promises.mkdir(path.join(dir, 'nested'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'nested/b.py'), '# B', 'utf8');

    const tool = new GlobTool();
    const absPattern = path.join(dir, '**/*.py');
    const result = await tool.execute(tool.validate({ pattern: absPattern }), { workspace });
    const realDir = await fs.promises.realpath(dir);

    expect(result.pattern).toBe(absPattern);
    expect(result.searchPath).toBe(realDir);
    expect(result.files.length).toBe(2);
  });

  it('supports absolute file path patterns without wildcards', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'nested'), { recursive: true });
    const absFile = path.join(dir, 'nested', 'single.py');
    await fs.promises.writeFile(absFile, '# Single', 'utf8');

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: absFile }), { workspace });

    expect(result.pattern).toBe(absFile);
    expect(result.truncated).toBe(false);
    expect(result.files.length).toBe(1);
    expect(path.basename(result.files[0])).toBe('single.py');
    expect(fs.existsSync(result.files[0])).toBe(true);
  });

  it('skips hidden files when include_hidden is false', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'visible.js'), 'test', 'utf8');
    await fs.promises.writeFile(path.join(dir, '.hidden.js'), 'test', 'utf8');

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '**/*.js', include_hidden: false }), { workspace });
    const basenames = result.files.map((match) => path.basename(match));
    expect(basenames).toContain('visible.js');
    expect(basenames).not.toContain('.hidden.js');
  });

  it('skips node_modules when include_node_modules is false', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'test', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'app.js'), 'test', 'utf8');

    const tool = new GlobTool();
    const result = await tool.execute(tool.validate({ pattern: '**/*.js', include_node_modules: false }), { workspace });
    expect(result.files.some((match) => match.includes(`${path.sep}node_modules${path.sep}`))).toBe(false);
    expect(result.files.map((match) => path.basename(match))).toContain('app.js');
  });
});

describe('GrepTool', () => {
  it('searches file contents and returns matching files', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'app.py'), "print('hello')", 'utf8');
    await fs.promises.writeFile(path.join(dir, 'utils.py'), "print('world')", 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'print' }), { workspace });

    expect(result.truncated).toBe(false);
    expect(result.matches.length).toBe(2);
    expect(result.matches.every((p) => p.endsWith('.py') && fs.existsSync(p))).toBe(true);
  });

  it('is case-sensitive by default', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'test.py'), "PRINT('test')", 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'print' }), { workspace });
    expect(result.matches.length).toBe(0);
  });

  it('supports include filters', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'test.py'), 'test', 'utf8');
    await fs.promises.writeFile(path.join(dir, 'test.js'), 'test', 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test', include: '*.py' }), { workspace });
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].endsWith('.py')).toBe(true);
  });

  it('includes hidden files by default', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'visible.py'), 'test', 'utf8');
    await fs.promises.writeFile(path.join(dir, '.hidden.py'), 'test', 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test' }), { workspace });
    const basenames = result.matches.map((match) => path.basename(match));
    expect(basenames).toContain('visible.py');
    expect(basenames).toContain('.hidden.py');
  });

  it('includes node_modules by default', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'test', 'utf8');
    await fs.promises.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'src', 'app.js'), 'test', 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test' }), { workspace });
    expect(result.matches.some((match) => match.includes(`${path.sep}node_modules${path.sep}`))).toBe(true);
  });

  it('skips hidden files when include_hidden is false', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.writeFile(path.join(dir, 'visible.py'), 'test', 'utf8');
    await fs.promises.writeFile(path.join(dir, '.hidden.py'), 'test', 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test', include_hidden: false }), { workspace });
    const basenames = result.matches.map((match) => path.basename(match));
    expect(basenames).toContain('visible.py');
    expect(basenames).not.toContain('.hidden.py');
  });

  it('skips node_modules when include_node_modules is false', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    await fs.promises.mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'test', 'utf8');
    await fs.promises.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'src', 'app.js'), 'test', 'utf8');

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test', include_node_modules: false }), { workspace });
    expect(result.matches.some((match) => match.includes(`${path.sep}node_modules${path.sep}`))).toBe(false);
    expect(result.matches.some((match) => match.includes(`${path.sep}src${path.sep}`))).toBe(true);
  });

  it('reports invalid regex patterns', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    const tool = new GrepTool();
    await expect(tool.execute(tool.validate({ pattern: '[invalid' }), { workspace }))
      .rejects.toThrowError(/Invalid regex pattern/);
  });

  it('truncates to 100 results', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);

    for (let i = 0; i < 150; i++) {
      await fs.promises.writeFile(path.join(dir, `file${i}.py`), 'test', 'utf8');
    }

    const tool = new GrepTool();
    const result = await tool.execute(tool.validate({ pattern: 'test' }), { workspace });
    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBe(100);
  });
});
