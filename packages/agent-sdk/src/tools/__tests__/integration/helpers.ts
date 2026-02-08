import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach } from 'vitest';
import { LocalWorkspace } from '../../../workspace/LocalWorkspace';

const created: string[] = [];

export const makeIntegrationWorkspace = async (prefix = 'tool-integration-') => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return { dir, workspace: new LocalWorkspace(dir) };
};

afterEach(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
  created.length = 0;
});
