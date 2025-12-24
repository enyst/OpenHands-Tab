#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const patchPath = path.join(__dirname, 'patch-os-cpus.cjs');
const isWindows = process.platform === 'win32';
const vsceBin = path.join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'vsce.cmd' : 'vsce');
const extraArgs = process.argv.slice(2);
const argsWithFollowSymlinks = extraArgs.includes('--follow-symlinks') ? extraArgs : ['--follow-symlinks', ...extraArgs];

let result;

if (isWindows) {
  const nodeOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} -r ${patchPath}` : `-r ${patchPath}`;
  result = spawnSync(vsceBin, ['package', ...argsWithFollowSymlinks], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    shell: true,
  });
} else {
  const nodeBinary = process.execPath;
  const args = ['-r', patchPath, vsceBin, 'package', ...argsWithFollowSymlinks];
  result = spawnSync(nodeBinary, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
}

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);

