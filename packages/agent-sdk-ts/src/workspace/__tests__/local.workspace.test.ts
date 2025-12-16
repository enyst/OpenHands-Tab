import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { LocalWorkspace } from '..';

const makeWorkspace = async (register: (dir: string) => void) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-'));
  register(dir);
  return { dir, workspace: new LocalWorkspace(dir) };
};

describe('LocalWorkspace', () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
    created.length = 0;
  });

  describe('file operations', () => {
    it('writes and reads files inside the sandbox', async () => {
      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      await workspace.writeFile('test.txt', 'hello');
      const content = await workspace.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('blocks path traversal attacks', async () => {
      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      const vectors = [
        '../sensitive.txt',
        '../../sensitive.txt',
        '../../../etc/passwd',
        'subdir/../../../sensitive.txt',
        'subdir/../../sensitive.txt',
        './../sensitive.txt',
        'a/../../../sensitive.txt',
      ];

      if (process.platform === 'win32') {
        vectors.push('..\\sensitive.txt');
      }

      for (const attackPath of vectors) {
        expect(() => workspace.resolvePath(attackPath)).toThrowError(/Path escapes workspace root/);
      }
    });

    it('allows legitimate paths inside the sandbox', async () => {
      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const realDir = await fs.promises.realpath(dir);

      const legitimatePaths = [
        'file.txt',
        'subdir/file.txt',
        'deep/nested/path/file.txt',
        'file_with_dots.txt',
        '.hidden_file',
        'subdir/.hidden',
      ];

      for (const legitPath of legitimatePaths) {
        const resolved = workspace.resolvePath(legitPath);
        const relative = path.relative(realDir, resolved);
        expect(
          relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)),
        ).toBe(true);
      }

      expect(workspace.resolvePath('')).toBe(realDir);
      expect(workspace.resolvePath('.')).toBe(realDir);
    });

    it('blocks symlink escapes for nested non-existent paths', async () => {
      if (process.platform === 'win32') return;

      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-outside-'));
      created.push(externalDir);

      const symlinkPath = path.join(dir, 'linked');
      await fs.promises.symlink(externalDir, symlinkPath, 'dir');

      expect(() => workspace.resolvePath('linked')).toThrowError(/Path escapes workspace root/);
      expect(() => workspace.resolvePath('linked/subdir/file.txt')).toThrowError(/Path escapes workspace root/);
    });

    it('allows symlinks that remain inside the sandbox', async () => {
      if (process.platform === 'win32') return;

      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const realDir = await fs.promises.realpath(dir);

      const target = path.join(dir, 'target');
      await fs.promises.mkdir(target, { recursive: true });

      const symlinkPath = path.join(dir, 'inside');
      await fs.promises.symlink(target, symlinkPath, 'dir');

      const resolved = workspace.resolvePath('inside/file.txt');
      const relative = path.relative(realDir, resolved);
      expect(
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)),
      ).toBe(true);
    });

    it('allows explicitly-approved external paths', async () => {
      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-external-'));
      created.push(externalDir);
      const externalFile = path.join(externalDir, 'outside.txt');
      await fs.promises.writeFile(externalFile, 'hello', 'utf8');

      expect(() => workspace.resolvePath(externalFile)).toThrowError();

      workspace.allowPath(externalFile);
      const realExternalFile = await fs.promises.realpath(externalFile);
      expect(workspace.resolvePath(externalFile)).toBe(realExternalFile);
      expect(() => workspace.resolvePath(path.join(externalFile, 'child'))).toThrowError();
    });
  });

  describe('commands', () => {
    it('runs commands rooted in the workspace', async () => {
      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const command = process.platform === 'win32' ? 'cd' : 'pwd';
      const result = await workspace.runCommand(command);
      expect(result.exitCode).toBe(0);
      const realDir = await fs.promises.realpath(dir);
      const printedDir = result.stdout.trim();
      if (process.platform === 'win32') {
        expect(printedDir.toLowerCase()).toBe(realDir.toLowerCase());
      } else {
        expect(printedDir).toBe(realDir);
      }
    });
  });
});
