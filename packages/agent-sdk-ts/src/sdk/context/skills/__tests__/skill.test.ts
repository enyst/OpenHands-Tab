import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Skill, SkillValidationError, loadSkillsFromDir, loadUserSkills, USER_SKILLS_DIRS } from '../skill';

describe('Skill', () => {
  describe('constructor', () => {
    it('creates a basic skill', () => {
      const skill = new Skill({
        name: 'test-skill',
        content: 'Test content',
        trigger: null,
      });

      expect(skill.name).toBe('test-skill');
      expect(skill.content).toBe('Test content');
      expect(skill.trigger).toBeNull();
      expect(skill.source).toBeNull();
      expect(skill.inputs).toEqual([]);
    });

    it('creates a skill with keyword trigger', () => {
      const skill = new Skill({
        name: 'react-skill',
        content: 'React best practices',
        trigger: { type: 'keyword', keywords: ['react', 'component'] },
      });

      expect(skill.trigger).toEqual({ type: 'keyword', keywords: ['react', 'component'] });
    });

    it('creates a skill with task trigger', () => {
      const skill = new Skill({
        name: 'refactor-skill',
        content: 'Refactor ${target_file}',
        trigger: { type: 'task', triggers: ['/refactor'] },
        inputs: [{ name: 'target_file', description: 'File to refactor' }],
      });

      expect(skill.trigger).toEqual({ type: 'task', triggers: ['/refactor'] });
      expect(skill.inputs).toHaveLength(1);
    });

    it('appends missing variables prompt for task skills with inputs', () => {
      const skill = new Skill({
        name: 'task-skill',
        content: 'Do something',
        trigger: { type: 'task', triggers: ['/test'] },
        inputs: [{ name: 'param', description: 'A parameter' }],
      });

      expect(skill.content).toContain("If the user didn't provide any of these variables");
    });

    it('does not duplicate missing variables prompt', () => {
      const contentWithPrompt = "Content\n\nIf the user didn't provide any of these variables, ask the user to provide them first before the agent can proceed with the task.";
      const skill = new Skill({
        name: 'task-skill',
        content: contentWithPrompt,
        trigger: { type: 'task', triggers: ['/test'] },
        inputs: [{ name: 'param', description: 'A parameter' }],
      });

      const matches = skill.content.match(/If the user didn't provide/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('matchTrigger', () => {
    it('returns null for repo skills', () => {
      const skill = new Skill({
        name: 'repo-skill',
        content: 'Content',
        trigger: null,
      });

      expect(skill.matchTrigger('any message')).toBeNull();
    });

    it('matches keyword triggers (case insensitive)', () => {
      const skill = new Skill({
        name: 'react-skill',
        content: 'React content',
        trigger: { type: 'keyword', keywords: ['react', 'component'] },
      });

      expect(skill.matchTrigger('How do I use React?')).toBe('react');
      expect(skill.matchTrigger('Create a COMPONENT')).toBe('component');
      expect(skill.matchTrigger('Angular framework')).toBeNull();
    });

    it('matches task triggers', () => {
      const skill = new Skill({
        name: 'refactor-skill',
        content: 'Refactor code',
        trigger: { type: 'task', triggers: ['/refactor', '/clean'] },
      });

      expect(skill.matchTrigger('Please /refactor this file')).toBe('/refactor');
      expect(skill.matchTrigger('/CLEAN the code')).toBe('/clean');
      expect(skill.matchTrigger('Just review')).toBeNull();
    });

    it('returns the first matching trigger', () => {
      const skill = new Skill({
        name: 'multi-skill',
        content: 'Content',
        trigger: { type: 'keyword', keywords: ['first', 'second'] },
      });

      expect(skill.matchTrigger('This has both first and second')).toBe('first');
    });
  });

  describe('extractVariables', () => {
    it('extracts variables from content', () => {
      const skill = new Skill({
        name: 'test',
        content: 'Use ${var1} and ${var2} for ${var1}',
        trigger: null,
      });

      const vars = skill.extractVariables();
      expect(vars).toEqual(['var1', 'var2', 'var1']); // Includes duplicates
    });

    it('returns empty array when no variables', () => {
      const skill = new Skill({
        name: 'test',
        content: 'No variables here',
        trigger: null,
      });

      expect(skill.extractVariables()).toEqual([]);
    });

    it('only matches valid variable names', () => {
      const skill = new Skill({
        name: 'test',
        content: '${valid_var} ${123invalid} ${also-invalid} ${_ok}',
        trigger: null,
      });

      const vars = skill.extractVariables();
      expect(vars).toEqual(['valid_var', '_ok']);
    });
  });

  describe('requiresUserInput', () => {
    it('returns true when content has variables', () => {
      const skill = new Skill({
        name: 'test',
        content: 'Use ${variable}',
        trigger: null,
      });

      expect(skill.requiresUserInput()).toBe(true);
    });

    it('returns true when inputs are defined', () => {
      const skill = new Skill({
        name: 'test',
        content: 'No variables',
        trigger: null,
        inputs: [{ name: 'param', description: 'A param' }],
      });

      expect(skill.requiresUserInput()).toBe(true);
    });

    it('returns false when no variables or inputs', () => {
      const skill = new Skill({
        name: 'test',
        content: 'Plain content',
        trigger: null,
      });

      expect(skill.requiresUserInput()).toBe(false);
    });
  });

  describe('Skill.load', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `skill-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('loads a basic skill from markdown file', () => {
      const skillPath = join(tempDir, 'basic-skill.md');
      writeFileSync(skillPath, 'This is the skill content.');

      const skill = Skill.load({ path: skillPath });

      expect(skill.name).toBe('basic-skill');
      expect(skill.content).toBe('This is the skill content.');
      expect(skill.trigger).toBeNull();
      expect(skill.source).toBe(skillPath);
    });

    it('loads skill with frontmatter metadata', () => {
      const skillPath = join(tempDir, 'meta-skill.md');
      const content = `---
name: custom-name
triggers:
  - keyword1
  - keyword2
---

Skill content here.`;
      writeFileSync(skillPath, content);

      const skill = Skill.load({ path: skillPath });

      expect(skill.name).toBe('custom-name');
      expect(skill.content).toBe('Skill content here.');
      expect(skill.trigger).toEqual({ type: 'keyword', keywords: ['keyword1', 'keyword2'] });
    });

    it('loads task skill with inputs', () => {
      const skillPath = join(tempDir, 'task-skill.md');
      const content = `---
name: refactor
triggers:
  - /refactor
inputs:
  - name: target_file
    description: File to refactor
  - name: pattern
    description: Pattern to use
---

Refactor \${target_file} using \${pattern}.`;
      writeFileSync(skillPath, content);

      const skill = Skill.load({ path: skillPath });

      expect(skill.name).toBe('refactor');
      expect(skill.trigger?.type).toBe('task');
      expect(skill.inputs).toHaveLength(2);
      expect(skill.inputs[0].name).toBe('target_file');
      expect(skill.inputs[1].name).toBe('pattern');
    });

    it('adds skill name trigger for task skills', () => {
      const skillPath = join(tempDir, 'mytask.md');
      const content = `---
inputs:
  - name: param
    description: A parameter
---

Task content.`;
      writeFileSync(skillPath, content);

      const skill = Skill.load({ path: skillPath });

      expect(skill.trigger?.type).toBe('task');
      if (skill.trigger?.type === 'task') {
        expect(skill.trigger.triggers).toContain('/mytask');
      }
    });

    it('loads .cursorrules as cursorrules skill', () => {
      const cursorrules = join(tempDir, '.cursorrules');
      writeFileSync(cursorrules, 'Cursor IDE rules');

      const skill = Skill.load({ path: cursorrules });

      expect(skill.name).toBe('cursorrules');
      expect(skill.content).toBe('Cursor IDE rules');
      expect(skill.trigger).toBeNull();
    });

    it('loads agents.md as agents skill', () => {
      const agentsFile = join(tempDir, 'agents.md');
      writeFileSync(agentsFile, 'Agent guidelines');

      const skill = Skill.load({ path: agentsFile });

      expect(skill.name).toBe('agents');
      expect(skill.content).toBe('Agent guidelines');
      expect(skill.trigger).toBeNull();
    });

    it('loads AGENTS.md as agents skill (case insensitive)', () => {
      const agentsFile = join(tempDir, 'AGENTS.md');
      writeFileSync(agentsFile, 'Agent guidelines uppercase');

      const skill = Skill.load({ path: agentsFile });

      expect(skill.name).toBe('agents');
      expect(skill.content).toBe('Agent guidelines uppercase');
    });

    it('throws SkillValidationError for invalid triggers metadata', () => {
      const skillPath = join(tempDir, 'invalid.md');
      const content = `---
triggers: "not-an-array"
---

Content.`;
      writeFileSync(skillPath, content);

      expect(() => Skill.load({ path: skillPath })).toThrow(SkillValidationError);
      expect(() => Skill.load({ path: skillPath })).toThrow('Triggers must be a list of strings');
    });

    it('throws SkillValidationError for invalid inputs metadata', () => {
      const skillPath = join(tempDir, 'invalid-inputs.md');
      const content = `---
inputs: "not-an-array"
---

Content.`;
      writeFileSync(skillPath, content);

      expect(() => Skill.load({ path: skillPath })).toThrow(SkillValidationError);
      expect(() => Skill.load({ path: skillPath })).toThrow('inputs must be a list');
    });

    it('uses provided file content instead of reading file', () => {
      const skillPath = join(tempDir, 'not-created.md');
      const skill = Skill.load({
        path: skillPath,
        fileContent: 'Provided content',
      });

      expect(skill.content).toBe('Provided content');
      expect(existsSync(skillPath)).toBe(false);
    });
  });

  describe('loadSkillsFromDir', () => {
    let tempDir: string;
    let skillDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `load-skills-test-${Date.now()}`);
      skillDir = join(tempDir, 'repo', '.openhands', 'skills');
      mkdirSync(skillDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('loads repo skills and knowledge skills separately', () => {
      const repoSkillPath = join(skillDir, 'repo-skill.md');
      writeFileSync(repoSkillPath, 'Repo guidelines');

      const knowledgeSkillPath = join(skillDir, 'knowledge-skill.md');
      writeFileSync(knowledgeSkillPath, `---
triggers:
  - keyword
---

Knowledge content`);

      const { repoSkills, knowledgeSkills } = loadSkillsFromDir(skillDir);

      expect(repoSkills.size).toBe(1);
      expect(knowledgeSkills.size).toBe(1);
      expect(repoSkills.has('repo-skill')).toBe(true);
      expect(knowledgeSkills.has('knowledge-skill')).toBe(true);
    });

    it('loads third-party files from repo root', () => {
      const repoRoot = join(tempDir, 'repo');
      writeFileSync(join(repoRoot, '.cursorrules'), 'Cursor rules');
      writeFileSync(join(repoRoot, 'agents.md'), 'Agent guidelines');

      const { repoSkills } = loadSkillsFromDir(skillDir);

      expect(repoSkills.has('cursorrules')).toBe(true);
      expect(repoSkills.has('agents')).toBe(true);
    });

    it('recursively loads skills from subdirectories', () => {
      const subDir = join(skillDir, 'subdir');
      mkdirSync(subDir);
      writeFileSync(join(subDir, 'nested-skill.md'), 'Nested content');

      const { repoSkills } = loadSkillsFromDir(skillDir);

      expect(repoSkills.has('subdir/nested-skill')).toBe(true);
    });

    it('skips README.md files', () => {
      writeFileSync(join(skillDir, 'README.md'), 'Documentation');
      writeFileSync(join(skillDir, 'real-skill.md'), 'Real skill');

      const { repoSkills } = loadSkillsFromDir(skillDir);

      expect(repoSkills.has('README')).toBe(false);
      expect(repoSkills.has('real-skill')).toBe(true);
    });

    it('handles non-existent skills directory', () => {
      const nonExistentDir = join(tempDir, 'non-existent', '.openhands', 'skills');
      const { repoSkills, knowledgeSkills } = loadSkillsFromDir(nonExistentDir);

      expect(repoSkills.size).toBe(0);
      expect(knowledgeSkills.size).toBe(0);
    });

    it('throws SkillValidationError for invalid skill files', () => {
      const invalidPath = join(skillDir, 'invalid.md');
      writeFileSync(invalidPath, `---
triggers: "invalid"
---

Content`);

      expect(() => loadSkillsFromDir(skillDir)).toThrow(SkillValidationError);
    });
  });

  describe('loadUserSkills', () => {
    let tempDir: string;
    let skillsDir: string;
    let originalDirs: string[];

    beforeEach(() => {
      tempDir = join(tmpdir(), `user-skills-test-${Date.now()}`);
      skillsDir = join(tempDir, '.openhands', 'skills');
      mkdirSync(skillsDir, { recursive: true });

      // Save original directories and replace with test directories
      originalDirs = [...USER_SKILLS_DIRS];
      USER_SKILLS_DIRS.length = 0;
      USER_SKILLS_DIRS.push(skillsDir);
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }

      // Restore original directories
      USER_SKILLS_DIRS.length = 0;
      USER_SKILLS_DIRS.push(...originalDirs);
    });

    it('returns empty array when user skills directories do not exist', () => {
      // Remove the directories we created
      rmSync(tempDir, { recursive: true, force: true });

      const skills = loadUserSkills();

      expect(skills).toEqual([]);
      expect(skills).toHaveLength(0);
    });

    it('loads skills from primary skills directory', () => {
      // Create a skill in the primary directory
      writeFileSync(join(skillsDir, 'test-skill.md'), `---
triggers:
  - test
---

Test skill content`);

      const skills = loadUserSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].content).toBe('Test skill content');
    });

    it('loads both repo skills and knowledge skills', () => {
      // Create a repo skill (no triggers)
      writeFileSync(join(skillsDir, 'repo-skill.md'), 'Repository guidelines');

      // Create a knowledge skill (with triggers)
      writeFileSync(join(skillsDir, 'knowledge-skill.md'), `---
triggers:
  - keyword
---

Knowledge content`);

      const skills = loadUserSkills();

      expect(skills).toHaveLength(2);

      const repoSkill = skills.find(s => s.name === 'repo-skill');
      const knowledgeSkill = skills.find(s => s.name === 'knowledge-skill');

      expect(repoSkill?.trigger).toBeNull();
      expect(knowledgeSkill?.trigger).toEqual({ type: 'keyword', keywords: ['keyword'] });
    });

    it('handles errors gracefully and continues loading', () => {
      // Create a valid skill
      writeFileSync(join(skillsDir, 'valid.md'), 'Valid content');

      // Create an invalid skill
      writeFileSync(join(skillsDir, 'invalid.md'), `---
triggers: "not-an-array"
---

Invalid`);

      // Mock console.warn to suppress warnings
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const skills = loadUserSkills();

      // Should continue despite error, but valid skill won't load either due to loadSkillsFromDir throwing
      // The error is caught and logged in loadUserSkills
      expect(skills).toEqual([]); // Returns empty array due to error
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls.some(call =>
        call[0].includes('Failed to load user skills')
      )).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
