import { existsSync, lstatSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function findThirdPartyFiles(
  repoRoot: string,
  pathToThirdPartySkillName: Record<string, string>,
): string[] {
  if (!existsSync(repoRoot)) return [];

  const targetNames = new Set(Object.keys(pathToThirdPartySkillName).map((name) => name.toLowerCase()));
  const files: string[] = [];
  const seenNames = new Set<string>();

  for (const entry of readdirSync(repoRoot)) {
    const fullPath = join(repoRoot, entry);
    if (!existsSync(fullPath)) continue;
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (!stat.isFile()) continue;

    const nameLower = entry.toLowerCase();
    if (!targetNames.has(nameLower)) continue;

    if (seenNames.has(nameLower)) {
      console.warn(`Duplicate third-party skill file ignored: ${fullPath} (already found a file with name '${nameLower}')`);
      continue;
    }

    files.push(fullPath);
    seenNames.add(nameLower);
  }

  return files;
}

export function collectLegacyMarkdownFiles(skillDir: string, excludedDirs: Set<string>): string[] {
  const mdFiles: string[] = [];

  if (!existsSync(skillDir)) {
    return mdFiles;
  }

  const collectMarkdownFiles = (dir: string): void => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (excludedDirs.has(fullPath)) continue;
        collectMarkdownFiles(fullPath);
      } else if (entry.endsWith('.md') && entry !== 'README.md' && entry.toLowerCase() !== 'skill.md') {
        mdFiles.push(fullPath);
      }
    }
  };

  collectMarkdownFiles(skillDir);
  return mdFiles;
}

function findSkillMd(skillDir: string): string | null {
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) return null;
  const entries = readdirSync(skillDir);
  for (const entry of entries) {
    const fullPath = join(skillDir, entry);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile() && entry.toLowerCase() === 'skill.md') {
      return fullPath;
    }
  }
  return null;
}

export function findSkillMdDirectories(skillsDir: string): string[] {
  const results: string[] = [];
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) return results;

  for (const entry of readdirSync(skillsDir)) {
    const fullPath = join(skillsDir, entry);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const skillMd = findSkillMd(fullPath);
    if (skillMd) results.push(skillMd);
  }

  return results;
}
