import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const packed = JSON.parse(
  execFileSync(
    npmCommand,
    ['pack', '--json', '--dry-run', '--ignore-scripts'],
    {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  ),
);

if (!Array.isArray(packed) || packed.length !== 1) {
  throw new Error(`Expected a single packed artifact, received: ${JSON.stringify(packed)}`);
}

const [{ name, version, files = [] }] = packed;
const forbiddenEntries = files
  .map((file) => file.path)
  .filter((filePath) => filePath.endsWith('.test.d.ts') || filePath.endsWith('.spec.d.ts'));

if (name !== manifest.name) {
  throw new Error(`Packed package name mismatch: expected ${manifest.name}, received ${name}`);
}

if (version !== manifest.version) {
  throw new Error(`Packed package version mismatch: expected ${manifest.version}, received ${version}`);
}

if (forbiddenEntries.length > 0) {
  throw new Error(
    `Packed artifact unexpectedly includes test declarations:\n${forbiddenEntries
      .map((filePath) => `- ${filePath}`)
      .join('\n')}`,
  );
}

console.log(`Verified ${name}@${version} pack contents (${files.length} entries).`);
