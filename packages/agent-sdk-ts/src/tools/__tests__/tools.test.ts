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

  it('accepts absolute paths that resolve inside the workspace', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const absPath = path.join(dir, 'abs.txt');
    await tool.execute(tool.validate({ command: 'create', path: absPath, file_text: 'hello' }), { workspace });
    expect(await workspace.readFile('abs.txt')).toBe('hello');
  });

  it('rejects absolute paths outside the workspace', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-tools-outside-'));
    created.push(externalDir);
    const absOutside = path.join(externalDir, 'outside.txt');

    await expect(
      tool.execute(tool.validate({ command: 'create', path: absOutside, file_text: 'nope' }), { workspace }),
    ).rejects.toThrowError(/Path escapes workspace root/i);
  });

  it('rejects create when file_text exceeds 10MB', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const oversized = 'a'.repeat(10 * 1024 * 1024 + 1);
    await expect(
      tool.execute(tool.validate({ command: 'create', path: 'big.txt', file_text: oversized }), { workspace }),
    ).rejects.toThrowError(/Maximum allowed size is 10MB/i);
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
    expect(viewed.length).toBeLessThanOrEqual(50_000);

    const parts = viewed.split('\n<response clipped>\n');
    expect(parts.length).toBe(2);
    const [head, tail] = parts;
    const maxChars = 50_000;
    const clipMarker = '<response clipped>';
    const half = Math.floor((maxChars - clipMarker.length - 2) / 2);
    expect(head.length).toBeLessThanOrEqual(half);
    expect(tail.length).toBeLessThanOrEqual(half);
  });

  it('views directories up to 2 levels deep, excluding hidden items', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await fs.promises.writeFile(path.join(dir, 'visible.txt'), 'visible');
    await fs.promises.writeFile(path.join(dir, '.hidden.txt'), 'hidden');
    await fs.promises.mkdir(path.join(dir, 'dirA', 'subdir'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'dirA', 'a.txt'), 'a');
    await fs.promises.writeFile(path.join(dir, 'dirA', '.hidden2'), 'x');
    await fs.promises.writeFile(path.join(dir, 'dirA', 'subdir', 'b.txt'), 'b');
    await fs.promises.mkdir(path.join(dir, '.hiddenDir'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, '.hiddenDir', 'x.txt'), 'x');

    const viewArgs = tool.validate({ command: 'view', path: '.' });
    const result = await tool.execute(viewArgs, { workspace });

    const listing = result.new_content ?? '';
    expect(listing).toContain('up to 2 levels deep');
    expect(listing).toContain('d .');
    expect(listing).toContain('f visible.txt');
    expect(listing).toContain('d dirA');
    expect(listing).toContain(`f ${path.join('dirA', 'a.txt')}`);
    expect(listing).toContain(`d ${path.join('dirA', 'subdir')}`);
    expect(listing).not.toContain(dir);

    // Max depth is 2 (root + children + grandchildren), so b.txt (depth 3) is excluded.
    expect(listing).not.toContain(path.join('dirA', 'subdir', 'b.txt'));

    // Hidden entries excluded (root + depth 2).
    expect(listing).not.toContain('.hidden.txt');
    expect(listing).not.toContain('.hiddenDir');
    expect(listing).not.toContain('.hidden2');
    expect(listing).toMatch(/2 hidden files\/directories/i);
  });

  it('directory view skips unreadable child directories', async () => {
    if (process.platform === 'win32') return;

    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await fs.promises.writeFile(path.join(dir, 'visible.txt'), 'visible');
    await fs.promises.mkdir(path.join(dir, 'unreadable'), { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'unreadable', 'secret.txt'), 'secret');

    try {
      await fs.promises.chmod(path.join(dir, 'unreadable'), 0o000);

      const viewArgs = tool.validate({ command: 'view', path: '.' });
      const result = await tool.execute(viewArgs, { workspace });

      const listing = result.new_content ?? '';
      expect(listing).toContain('f visible.txt');
      expect(listing).toContain('d unreadable');
      expect(listing).toContain('skipped unreadable: unreadable');
    } finally {
      await fs.promises.chmod(path.join(dir, 'unreadable'), 0o755);
    }
  });

  it('rejects binary files (except supported types)', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const binaryPath = path.join(dir, 'binary.bin');
    await fs.promises.writeFile(binaryPath, Buffer.from('Some text\u0000with binary\u0000content', 'utf8'));

    await expect(tool.execute(tool.validate({ command: 'view', path: 'binary.bin' }), { workspace }))
      .rejects.toThrowError(/binary/i);
  });

  it('views PDF files as text', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const pdfContent = Buffer.from(
      `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
72 720 Td
(Printer-Friendly Caltrain Schedule) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
299
%%EOF`,
      'utf8',
    );
    await fs.promises.writeFile(path.join(dir, 'sample.pdf'), pdfContent);

    const result = await tool.execute(tool.validate({ command: 'view', path: 'sample.pdf' }), { workspace });
    expect(result.new_content).toContain('Printer-Friendly Caltrain Schedule');
  });

  it('rejects editing PDF files', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await fs.promises.writeFile(path.join(dir, 'sample.pdf'), Buffer.from('%PDF-1.4\nHello', 'utf8'));

    await expect(
      tool.execute(tool.validate({ command: 'str_replace', path: 'sample.pdf', old_str: 'Hello', new_str: 'World' }), { workspace }),
    ).rejects.toThrowError(/refusing to edit binary/i);

    await expect(
      tool.execute(tool.validate({ command: 'insert', path: 'sample.pdf', insert_line: 1, new_str: 'x' }), { workspace }),
    ).rejects.toThrowError(/refusing to edit binary/i);
  });

  it('views image files by returning image content URLs', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const pngData = Buffer.from(
      [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
        0x90, 0x77, 0x53, 0xde,
        0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
        0x00, 0x03, 0x00, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND
      ],
    );
    await fs.promises.writeFile(path.join(dir, 'test.png'), pngData);

    const result = await tool.execute(tool.validate({ command: 'view', path: 'test.png' }), { workspace });
    expect(result.new_content).toContain('Image file');
    expect(result.content).toBeDefined();
    expect(result.content?.some((c) => c.type === 'image')).toBe(true);
    const image = result.content?.find((c) => c.type === 'image') as { image_urls?: string[] } | undefined;
    expect(image?.image_urls?.[0]).toMatch(/^data:image\/png;base64,/);
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

  it('caps undo_edit history across paths', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const maxPaths = 100;
    for (let i = 0; i < maxPaths + 1; i++) {
      await tool.execute(tool.validate({ command: 'create', path: `file-${i}.txt`, file_text: String(i) }), { workspace });
    }

    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'file-0.txt' }), { workspace }))
      .rejects.toThrowError(/no edit history/i);

    await tool.execute(tool.validate({ command: 'undo_edit', path: `file-${maxPaths}.txt` }), { workspace });
    await expect(workspace.readFile(`file-${maxPaths}.txt`)).rejects.toThrowError();
  });

  it('prunes undo_edit history by byte cap without losing the latest edit', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    const baseSizeBytes = 6 * 1024 * 1024;
    const marker0 = 'MARK0';
    const padding = 'A'.repeat(baseSizeBytes - marker0.length);
    await tool.execute(tool.validate({ command: 'create', path: 'big.txt', file_text: `${padding}${marker0}` }), { workspace });

    for (let i = 0; i < 9; i++) {
      await tool.execute(
        tool.validate({ command: 'str_replace', path: 'big.txt', old_str: `MARK${i}`, new_str: `MARK${i + 1}` }),
        { workspace },
      );
    }
    expect(await workspace.readFile('big.txt')).toContain('MARK9');

    for (let i = 9; i >= 2; i--) {
      await tool.execute(tool.validate({ command: 'undo_edit', path: 'big.txt' }), { workspace });
      expect(await workspace.readFile('big.txt')).toContain(`MARK${i - 1}`);
    }

    await tool.execute(tool.validate({ command: 'undo_edit', path: 'big.txt' }), { workspace });
    await expect(workspace.readFile('big.txt')).rejects.toThrowError();
    await expect(tool.execute(tool.validate({ command: 'undo_edit', path: 'big.txt' }), { workspace }))
      .rejects.toThrowError(/no edit history/i);
  });

  it('requires old_str to be unique for str_replace', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'dup\ndup' }), { workspace });
    await expect(
      tool.execute(tool.validate({ command: 'str_replace', path: 'note.txt', old_str: 'dup', new_str: 'x' }), { workspace }),
    ).rejects.toThrowError(/not unique/i);
  });

  it('rejects empty old_str for str_replace', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'content' }), { workspace });
    expect(() => tool.validate({ command: 'str_replace', path: 'note.txt', old_str: '', new_str: 'x' })).toThrowError(
      /old_str.*non-empty/i,
    );
  });

  it('treats overlapping old_str matches as not unique', async () => {
    const { workspace, dir } = await makeWorkspace();
    created.push(dir);
    const tool = new FileEditorTool();

    await tool.execute(tool.validate({ command: 'create', path: 'note.txt', file_text: 'aaa' }), { workspace });
    await expect(
      tool.execute(tool.validate({ command: 'str_replace', path: 'note.txt', old_str: 'aa', new_str: 'b' }), { workspace }),
    ).rejects.toThrowError(/not unique/i);
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
