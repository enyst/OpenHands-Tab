import fs from 'fs';
import * as os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  findContainingDirRoot,
  normalizeExistingOrParent,
  resolveAllowedPath,
  type AllowedRootKind,
} from '../localWorkspacePathPolicy';

describe('localWorkspacePathPolicy', () => {
  it('resolves paths inside allowlisted directory roots and blocks escapes', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-policy-'));
    const root = await fs.promises.realpath(tempRoot);
    const nestedDir = path.join(root, 'nested');
    await fs.promises.mkdir(nestedDir);
    const nestedFile = path.join(nestedDir, 'file.txt');
    await fs.promises.writeFile(nestedFile, 'hello', 'utf8');

    const allowedRoots = new Map<string, AllowedRootKind>([[root, 'dir']]);
    expect(resolveAllowedPath(nestedFile, root, allowedRoots)).toBe(nestedFile);
    expect(() => resolveAllowedPath(path.join(root, '..', 'outside.txt'), root, allowedRoots)).toThrowError(/Path escapes workspace root/);
  });

  it('supports file-only allowlist entries', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-policy-file-'));
    const dir = await fs.promises.realpath(tempDir);
    const allowedFile = path.join(dir, 'allowed.txt');
    await fs.promises.writeFile(allowedFile, 'ok', 'utf8');

    const allowedRoots = new Map<string, AllowedRootKind>([[allowedFile, 'file']]);
    expect(resolveAllowedPath(allowedFile, dir, allowedRoots)).toBe(allowedFile);
    expect(() => resolveAllowedPath(path.join(allowedFile, 'child'), dir, allowedRoots)).toThrow();
  });

  it('prefers the deepest containing directory root', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-ws-policy-root-'));
    const dir = await fs.promises.realpath(tempDir);
    const sub = path.join(dir, 'sub');
    await fs.promises.mkdir(sub);
    const target = path.join(sub, 'file.txt');

    const allowedRoots = new Map<string, AllowedRootKind>([
      [dir, 'dir'],
      [sub, 'dir'],
    ]);

    expect(findContainingDirRoot(target, allowedRoots)).toBe(sub);
    expect(normalizeExistingOrParent(path.join(dir, 'missing', 'file.txt'))).toBe(path.join(dir, 'missing', 'file.txt'));
  });
});
