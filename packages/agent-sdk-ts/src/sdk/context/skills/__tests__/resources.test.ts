import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { discoverSkillResources, hasSkillResources } from '../resources';

// Check if symlinks are supported (may fail on Windows without developer mode)
function canCreateSymlinks(): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-probe-'));
    const target = path.join(tmp, 't');
    const link = path.join(tmp, 'l');
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, link);
    fs.rmSync(tmp, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

describe('Skill resources', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-resources-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('discoverSkillResources', () => {
    it('returns empty arrays when no resource directories exist', () => {
      const resources = discoverSkillResources(tempDir);
      expect(resources.skillRoot).toBe(tempDir);
      expect(resources.scripts).toEqual([]);
      expect(resources.references).toEqual([]);
      expect(resources.assets).toEqual([]);
    });

    it('discovers files in scripts directory', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(scriptsDir);
      fs.writeFileSync(path.join(scriptsDir, 'build.sh'), '#!/bin/bash');
      fs.writeFileSync(path.join(scriptsDir, 'test.sh'), '#!/bin/bash');

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toContain('build.sh');
      expect(resources.scripts).toContain('test.sh');
      expect(resources.scripts).toHaveLength(2);
    });

    it('discovers files in references directory', () => {
      const refsDir = path.join(tempDir, 'references');
      fs.mkdirSync(refsDir);
      fs.writeFileSync(path.join(refsDir, 'api-docs.md'), '# API');
      fs.writeFileSync(path.join(refsDir, 'style-guide.md'), '# Style');

      const resources = discoverSkillResources(tempDir);
      expect(resources.references).toContain('api-docs.md');
      expect(resources.references).toContain('style-guide.md');
    });

    it('discovers files in assets directory', () => {
      const assetsDir = path.join(tempDir, 'assets');
      fs.mkdirSync(assetsDir);
      fs.writeFileSync(path.join(assetsDir, 'logo.png'), 'image data');
      fs.writeFileSync(path.join(assetsDir, 'config.json'), '{}');

      const resources = discoverSkillResources(tempDir);
      expect(resources.assets).toContain('logo.png');
      expect(resources.assets).toContain('config.json');
    });

    it('discovers files recursively in subdirectories', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      const subDir = path.join(scriptsDir, 'utils');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(scriptsDir, 'main.sh'), '#!/bin/bash');
      fs.writeFileSync(path.join(subDir, 'helper.sh'), '#!/bin/bash');

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toContain('main.sh');
      expect(resources.scripts).toContain(path.join('utils', 'helper.sh'));
    });

    it('returns sorted file lists', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(scriptsDir);
      fs.writeFileSync(path.join(scriptsDir, 'z-script.sh'), '');
      fs.writeFileSync(path.join(scriptsDir, 'a-script.sh'), '');
      fs.writeFileSync(path.join(scriptsDir, 'm-script.sh'), '');

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toEqual(['a-script.sh', 'm-script.sh', 'z-script.sh']);
    });

    it.skipIf(!canCreateSymlinks())('ignores symlinks in resource directories', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(scriptsDir);
      fs.writeFileSync(path.join(scriptsDir, 'real.sh'), '#!/bin/bash');
      fs.symlinkSync(path.join(scriptsDir, 'real.sh'), path.join(scriptsDir, 'link.sh'));

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toContain('real.sh');
      expect(resources.scripts).not.toContain('link.sh');
    });

    it.skipIf(!canCreateSymlinks())('ignores symlinked resource directories', () => {
      const realDir = path.join(tempDir, 'real-scripts');
      fs.mkdirSync(realDir);
      fs.writeFileSync(path.join(realDir, 'test.sh'), '#!/bin/bash');
      fs.symlinkSync(realDir, path.join(tempDir, 'scripts'));

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toEqual([]);
    });

    it('resolves relative paths', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(scriptsDir);
      fs.writeFileSync(path.join(scriptsDir, 'test.sh'), '');

      const cwd = process.cwd();
      const relativePath = path.relative(cwd, tempDir);

      const resources = discoverSkillResources(relativePath);
      expect(resources.skillRoot).toBe(path.resolve(relativePath));
      expect(resources.scripts).toContain('test.sh');
    });

    it('handles multiple resource directories', () => {
      // Create all directories
      fs.mkdirSync(path.join(tempDir, 'scripts'));
      fs.mkdirSync(path.join(tempDir, 'references'));
      fs.mkdirSync(path.join(tempDir, 'assets'));

      // Add files to each
      fs.writeFileSync(path.join(tempDir, 'scripts', 'build.sh'), '');
      fs.writeFileSync(path.join(tempDir, 'references', 'docs.md'), '');
      fs.writeFileSync(path.join(tempDir, 'assets', 'icon.png'), '');

      const resources = discoverSkillResources(tempDir);
      expect(resources.scripts).toContain('build.sh');
      expect(resources.references).toContain('docs.md');
      expect(resources.assets).toContain('icon.png');
    });
  });

  describe('hasSkillResources', () => {
    it('returns false when all resource arrays are empty', () => {
      const resources = {
        skillRoot: tempDir,
        scripts: [],
        references: [],
        assets: [],
      };
      expect(hasSkillResources(resources)).toBe(false);
    });

    it('returns true when scripts is non-empty', () => {
      const resources = {
        skillRoot: tempDir,
        scripts: ['test.sh'],
        references: [],
        assets: [],
      };
      expect(hasSkillResources(resources)).toBe(true);
    });

    it('returns true when references is non-empty', () => {
      const resources = {
        skillRoot: tempDir,
        scripts: [],
        references: ['docs.md'],
        assets: [],
      };
      expect(hasSkillResources(resources)).toBe(true);
    });

    it('returns true when assets is non-empty', () => {
      const resources = {
        skillRoot: tempDir,
        scripts: [],
        references: [],
        assets: ['icon.png'],
      };
      expect(hasSkillResources(resources)).toBe(true);
    });

    it('returns true when multiple resource types are present', () => {
      const resources = {
        skillRoot: tempDir,
        scripts: ['build.sh'],
        references: ['docs.md'],
        assets: ['icon.png'],
      };
      expect(hasSkillResources(resources)).toBe(true);
    });
  });
});
