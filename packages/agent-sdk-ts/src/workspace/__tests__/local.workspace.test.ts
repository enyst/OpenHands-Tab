import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, afterEach, vi } from 'vitest';
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

    it('blocks dangling symlink escapes (even when target does not exist)', async () => {
      if (process.platform === 'win32') return;

      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-dangling-'));
      created.push(externalDir);
      await fs.promises.rm(externalDir, { recursive: true, force: true });

      const symlinkPath = path.join(dir, 'dangling');
      await fs.promises.symlink(externalDir, symlinkPath, 'dir');

      expect(() => workspace.resolvePath('dangling/secret.txt')).toThrowError();
      await expect(workspace.writeFile('dangling/secret.txt', 'nope')).rejects.toThrowError();
      expect(fs.existsSync(externalDir)).toBe(false);
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

    it('does not create parent directories for file-only external allowances', async () => {
      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-external-missing-'));
      created.push(externalDir);
      await fs.promises.rm(externalDir, { recursive: true, force: true });
      expect(fs.existsSync(externalDir)).toBe(false);

      const externalFile = path.join(externalDir, 'outside.txt');
      workspace.allowPath(externalFile);

      await expect(workspace.writeFile(externalFile, 'hello')).rejects.toThrowError(/parent directory does not exist/i);
      expect(fs.existsSync(externalDir)).toBe(false);
    });

    it('rejects file-only allowances when the parent becomes a symlink mid-write', async () => {
      if (process.platform === 'win32') return;

      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      const externalDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-external-parent-'));
      created.push(externalDir);
      const parentDir = path.join(externalDir, 'allowed-parent');
      await fs.promises.mkdir(parentDir, { recursive: true });

      const allowedFile = path.join(parentDir, 'outside.txt');
      await fs.promises.writeFile(allowedFile, 'original', 'utf8');
      workspace.allowPath(allowedFile);

      const resolvedAllowedFile = workspace.resolvePath(allowedFile);
      const canonicalParentDir = path.dirname(resolvedAllowedFile);

      const redirectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-redirect-'));
      created.push(redirectDir);

      let swapped = false;
      const swapParent = async () => {
        if (swapped) return;
        swapped = true;
        const backupDir = `${canonicalParentDir}-bak`;
        await fs.promises.rename(canonicalParentDir, backupDir);
        await fs.promises.symlink(redirectDir, canonicalParentDir, 'dir');
      };

      const originalRealpath = fs.promises.realpath;
      let parentRealpathCalls = 0;
      const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation(async (targetPath, ...args) => {
        const targetString = targetPath instanceof Buffer ? targetPath.toString() : String(targetPath);
        const result = await originalRealpath.call(fs.promises, targetPath as never, ...(args as never[]));
        if (!swapped && targetString === canonicalParentDir) {
          parentRealpathCalls += 1;
          if (parentRealpathCalls === 1) {
            await swapParent();
          }
        }
        return result;
      });

      try {
        await expect(workspace.writeFile(allowedFile, 'hello')).rejects.toThrowError(/symlink|escapes|refusing|parent/i);
        expect(fs.existsSync(path.join(redirectDir, 'outside.txt'))).toBe(false);
      } finally {
        realpathSpy.mockRestore();
      }
    });

    it('rejects workspace writes when the parent becomes a symlink mid-write', async () => {
      if (process.platform === 'win32') return;

      const { workspace } = await makeWorkspace((value) => created.push(value));
      await workspace.ensureDirectory('parent');
      const canonicalParentDir = workspace.resolvePath('parent');

      const redirectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-redirect-workspace-'));
      created.push(redirectDir);

      let swapped = false;
      const swapParent = async () => {
        if (swapped) return;
        swapped = true;
        const backupDir = `${canonicalParentDir}-bak`;
        await fs.promises.rename(canonicalParentDir, backupDir);
        await fs.promises.symlink(redirectDir, canonicalParentDir, 'dir');
      };

      const originalRealpath = fs.promises.realpath;
      let parentRealpathCalls = 0;
      const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation(async (targetPath, ...args) => {
        const targetString = targetPath instanceof Buffer ? targetPath.toString() : String(targetPath);
        const result = await originalRealpath.call(fs.promises, targetPath as never, ...(args as never[]));
        if (!swapped && targetString === canonicalParentDir) {
          parentRealpathCalls += 1;
          if (parentRealpathCalls === 4) {
            await swapParent();
          }
        }
        return result;
      });

      try {
        await expect(workspace.writeFile('parent/inside.txt', 'hello')).rejects.toThrowError(/symlink|escapes|refusing|parent/i);
        expect(fs.existsSync(path.join(redirectDir, 'inside.txt'))).toBe(false);
      } finally {
        realpathSpy.mockRestore();
      }
    });

    it('rejects directory creation when an ancestor becomes a symlink mid-create', async () => {
      if (process.platform === 'win32') return;

      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const parentDir = path.join(dir, 'parent');
      await fs.promises.mkdir(parentDir, { recursive: true });
      const canonicalParentDir = await fs.promises.realpath(parentDir);

      const redirectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-redirect-dir-'));
      created.push(redirectDir);

      let swapped = false;
      const swapParent = async () => {
        if (swapped) return;
        swapped = true;
        const backupDir = `${canonicalParentDir}-bak`;
        await fs.promises.rename(canonicalParentDir, backupDir);
        await fs.promises.symlink(redirectDir, canonicalParentDir, 'dir');
      };

      const originalLstat = fs.promises.lstat;
      let parentLstatCalls = 0;
      const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (targetPath, ...args) => {
        const targetString = targetPath instanceof Buffer ? targetPath.toString() : String(targetPath);
        const result = await originalLstat.call(fs.promises, targetPath as never, ...(args as never[]));
        if (!swapped && targetString === canonicalParentDir) {
          parentLstatCalls += 1;
          if (parentLstatCalls === 2) {
            await swapParent();
          }
        }
        return result;
      });

      try {
        await expect(workspace.ensureDirectory('parent/child')).rejects.toThrowError(/symlink|escapes|Path escapes/i);
        expect(fs.existsSync(path.join(redirectDir, 'child'))).toBe(false);
      } finally {
        lstatSpy.mockRestore();
      }
    });
  });

  describe('commands', () => {
    it('runs commands rooted in the workspace', async () => {
      const { workspace, dir } = await makeWorkspace((value) => created.push(value));
      const command = process.platform === 'win32' ? 'cd' : 'pwd';
      const result = await workspace.runCommand(command, process.platform === 'win32' ? { shell: true } : undefined);
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
