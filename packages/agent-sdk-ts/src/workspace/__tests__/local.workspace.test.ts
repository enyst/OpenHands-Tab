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

    it('blocks traversal outside the sandbox', async () => {
      const { workspace } = await makeWorkspace((dir) => created.push(dir));
      expect(() => workspace.resolvePath('../etc/passwd')).toThrowError();
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
      const result = await workspace.runCommand('pwd');
      expect(result.exitCode).toBe(0);
      const realDir = await fs.promises.realpath(dir);
      expect(result.stdout.trim()).toBe(realDir);
    });
  });
});
