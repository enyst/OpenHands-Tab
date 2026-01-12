import { existsSync, lstatSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { SkillResources } from './types';

const RESOURCE_DIRECTORIES = ['scripts', 'references', 'assets'] as const;

const listFilesRecursively = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = lstatSync(fullPath);

    // Never follow symlinks; they can escape the skill root or form loops.
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      for (const nested of listFilesRecursively(fullPath)) {
        files.push(join(entry, nested));
      }
    } else if (stat.isFile()) {
      files.push(entry);
    }
  }
  return files;
};

export function discoverSkillResources(skillRoot: string): SkillResources {
  const resolvedRoot = resolve(skillRoot);

  const resources: SkillResources = {
    skillRoot: resolvedRoot,
    scripts: [],
    references: [],
    assets: [],
  };

  for (const kind of RESOURCE_DIRECTORIES) {
    const resourceDir = join(resolvedRoot, kind);
    if (!existsSync(resourceDir)) continue;

    try {
      const stat = lstatSync(resourceDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      resources[kind] = listFilesRecursively(resourceDir).sort();
    } catch {
      resources[kind] = [];
    }
  }

  return resources;
}

export function hasSkillResources(resources: SkillResources): boolean {
  return Boolean(resources.scripts.length || resources.references.length || resources.assets.length);
}
