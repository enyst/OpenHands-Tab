import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AgentContext } from '../agent-context';
import { Skill } from '../skills';
import type { Message } from '../../types';

describe('AgentContext', () => {
  describe('constructor', () => {
    it('creates empty context with defaults', () => {
      const context = new AgentContext();

      expect(context.skills).toEqual([]);
      expect(context.systemMessageSuffix).toBeUndefined();
      expect(context.userMessageSuffix).toBeUndefined();
      expect(context.loadUserSkills).toBe(false);
    });

    it('creates context with skills', () => {
      const skill = new Skill({
        name: 'test-skill',
        content: 'Test content',
        trigger: null,
      });

      const context = new AgentContext({ skills: [skill] });

      expect(context.skills).toHaveLength(1);
      expect(context.skills[0].name).toBe('test-skill');
    });

    it('creates context with custom suffixes', () => {
      const context = new AgentContext({
        systemMessageSuffix: 'System info',
        userMessageSuffix: 'User info',
      });

      expect(context.systemMessageSuffix).toBe('System info');
      expect(context.userMessageSuffix).toBe('User info');
    });

    it('throws error for duplicate skill names', () => {
      const skill1 = new Skill({ name: 'duplicate', content: 'Content 1', trigger: null });
      const skill2 = new Skill({ name: 'duplicate', content: 'Content 2', trigger: null });

      expect(() => new AgentContext({ skills: [skill1, skill2] })).toThrow(
        'Duplicate skill name found: duplicate'
      );
    });

    it('loads user skills when loadUserSkills is true', async () => {
      // Mock loadUserSkills to return test skills
      const mockSkill = new Skill({ name: 'user-skill', content: 'User content', trigger: null });
      const skillsModule = await import('../skills');
      const loadUserSkillsSpy = vi.spyOn(skillsModule, 'loadUserSkills');
      loadUserSkillsSpy.mockReturnValue([mockSkill]);

      const context = new AgentContext({ loadUserSkills: true });

      expect(context.skills).toHaveLength(1);
      expect(context.skills[0].name).toBe('user-skill');

      loadUserSkillsSpy.mockRestore();
    });

    it('merges user skills with explicit skills', async () => {
      const explicitSkill = new Skill({ name: 'explicit', content: 'Explicit', trigger: null });
      const userSkill = new Skill({ name: 'user', content: 'User', trigger: null });

      const skillsModule = await import('../skills');
      const loadUserSkillsSpy = vi.spyOn(skillsModule, 'loadUserSkills');
      loadUserSkillsSpy.mockReturnValue([userSkill]);

      const context = new AgentContext({
        skills: [explicitSkill],
        loadUserSkills: true,
      });

      expect(context.skills).toHaveLength(2);
      expect(context.skills.map((s) => s.name)).toEqual(['explicit', 'user']);

      loadUserSkillsSpy.mockRestore();
    });

    it('skips duplicate user skills', async () => {
      const explicitSkill = new Skill({ name: 'shared', content: 'Explicit', trigger: null });
      const userSkill = new Skill({ name: 'shared', content: 'User', trigger: null });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const skillsModule = await import('../skills');
      const loadUserSkillsSpy = vi.spyOn(skillsModule, 'loadUserSkills');
      loadUserSkillsSpy.mockReturnValue([userSkill]);

      const context = new AgentContext({
        skills: [explicitSkill],
        loadUserSkills: true,
      });

      expect(context.skills).toHaveLength(1);
      expect(context.skills[0].content).toBe('Explicit'); // Keeps explicit skill
      expect(consoleSpy).toHaveBeenCalledWith(
        "Skipping user skill 'shared' (already in explicit skills)"
      );

      loadUserSkillsSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('handles loadUserSkills errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const skillsModule = await import('../skills');
      const loadUserSkillsSpy = vi.spyOn(skillsModule, 'loadUserSkills');
      loadUserSkillsSpy.mockImplementation(() => {
        throw new Error('Failed to load');
      });

      const context = new AgentContext({ loadUserSkills: true });

      expect(context.skills).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load user skills: Failed to load');

      loadUserSkillsSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('getSystemMessageSuffix', () => {
    it('returns null when no repo skills or suffix', () => {
      const context = new AgentContext();
      expect(context.getSystemMessageSuffix()).toBeNull();
    });

    it('returns repo skill content', () => {
      const repoSkill = new Skill({
        name: 'coding-standards',
        content: 'Use TypeScript strict mode.',
        trigger: null,
      });

      const context = new AgentContext({ skills: [repoSkill] });
      const suffix = context.getSystemMessageSuffix();

      expect(suffix).toBe('## coding-standards\n\nUse TypeScript strict mode.');
    });

    it('combines multiple repo skills', () => {
      const skill1 = new Skill({ name: 'style', content: 'Style guide', trigger: null });
      const skill2 = new Skill({ name: 'security', content: 'Security rules', trigger: null });

      const context = new AgentContext({ skills: [skill1, skill2] });
      const suffix = context.getSystemMessageSuffix();

      expect(suffix).toContain('## style\n\nStyle guide');
      expect(suffix).toContain('## security\n\nSecurity rules');
    });

    it('excludes knowledge skills from system suffix', () => {
      const repoSkill = new Skill({ name: 'repo', content: 'Repo', trigger: null });
      const knowledgeSkill = new Skill({
        name: 'knowledge',
        content: 'Knowledge',
        trigger: { type: 'keyword', keywords: ['test'] },
      });

      const context = new AgentContext({ skills: [repoSkill, knowledgeSkill] });
      const suffix = context.getSystemMessageSuffix();

      expect(suffix).toContain('repo');
      expect(suffix).not.toContain('knowledge');
    });

    it('appends custom system message suffix', () => {
      const repoSkill = new Skill({ name: 'repo', content: 'Repo', trigger: null });

      const context = new AgentContext({
        skills: [repoSkill],
        systemMessageSuffix: 'Current date: 2025-01-15',
      });
      const suffix = context.getSystemMessageSuffix();

      expect(suffix).toContain('## repo\n\nRepo');
      expect(suffix).toContain('Current date: 2025-01-15');
    });

    it('returns custom suffix when no repo skills', () => {
      const context = new AgentContext({
        systemMessageSuffix: 'Just custom info',
      });

      expect(context.getSystemMessageSuffix()).toBe('Just custom info');
    });

    it('trims whitespace from suffixes', () => {
      const context = new AgentContext({
        systemMessageSuffix: '  \n  Trimmed  \n  ',
      });

      expect(context.getSystemMessageSuffix()).toBe('Trimmed');
    });
  });

  describe('getUserMessageSuffix', () => {
    it('returns null when no skills match and no suffix', () => {
      const context = new AgentContext();
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };

      expect(context.getUserMessageSuffix(message)).toBeNull();
    });

    it('returns null for empty message with no suffix', () => {
      const context = new AgentContext();
      const message: Message = {
        role: 'user',
        content: [],
      };

      expect(context.getUserMessageSuffix(message)).toBeNull();
    });

    it('returns custom suffix for empty message', () => {
      const context = new AgentContext({
        userMessageSuffix: 'Default info',
      });
      const message: Message = {
        role: 'user',
        content: [],
      };

      const result = context.getUserMessageSuffix(message);
      expect(result?.content.text).toBe('Default info');
      expect(result?.activatedSkillNames).toEqual([]);
    });

    it('triggers keyword skills', () => {
      const skill = new Skill({
        name: 'react-skill',
        content: 'React best practices',
        trigger: { type: 'keyword', keywords: ['react'] },
      });

      const context = new AgentContext({ skills: [skill] });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'How do I use React hooks?' }],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result).not.toBeNull();
      expect(result?.activatedSkillNames).toEqual(['react-skill']);
      expect(result?.content.text).toContain('React best practices');
      expect(result?.content.text).toContain('<EXTRA_INFO>');
      expect(result?.content.text).toContain('keyword match for "react"');
    });

    it('triggers multiple skills', () => {
      const skill1 = new Skill({
        name: 'react-skill',
        content: 'React info',
        trigger: { type: 'keyword', keywords: ['react'] },
      });
      const skill2 = new Skill({
        name: 'typescript-skill',
        content: 'TypeScript info',
        trigger: { type: 'keyword', keywords: ['typescript'] },
      });

      const context = new AgentContext({ skills: [skill1, skill2] });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Use React with TypeScript' }],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result?.activatedSkillNames).toEqual(['react-skill', 'typescript-skill']);
      expect(result?.content.text).toContain('React info');
      expect(result?.content.text).toContain('TypeScript info');
    });

    it('skips skills in skipSkillNames', () => {
      const skill = new Skill({
        name: 'react-skill',
        content: 'React info',
        trigger: { type: 'keyword', keywords: ['react'] },
      });

      const context = new AgentContext({ skills: [skill] });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Use React' }],
      };

      const result = context.getUserMessageSuffix(message, ['react-skill']);

      expect(result).toBeNull();
    });

    it('appends custom user message suffix to triggered skills', () => {
      const skill = new Skill({
        name: 'test-skill',
        content: 'Skill info',
        trigger: { type: 'keyword', keywords: ['test'] },
      });

      const context = new AgentContext({
        skills: [skill],
        userMessageSuffix: 'Custom user info',
      });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Run a test' }],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result?.content.text).toContain('Skill info');
      expect(result?.content.text).toContain('Custom user info');
    });

    it('returns only custom suffix when no skills triggered', () => {
      const context = new AgentContext({
        userMessageSuffix: 'Just custom',
      });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Some message' }],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result?.content.text).toBe('Just custom');
      expect(result?.activatedSkillNames).toEqual([]);
    });

    it('handles multiple text content blocks', () => {
      const skill = new Skill({
        name: 'test-skill',
        content: 'Test info',
        trigger: { type: 'keyword', keywords: ['keyword'] },
      });

      const context = new AgentContext({ skills: [skill] });
      const message: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'has keyword here' },
        ],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result?.activatedSkillNames).toEqual(['test-skill']);
    });

    it('ignores repo skills (null trigger)', () => {
      const repoSkill = new Skill({
        name: 'repo-skill',
        content: 'Repo content',
        trigger: null,
      });

      const context = new AgentContext({ skills: [repoSkill] });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Any message' }],
      };

      expect(context.getUserMessageSuffix(message)).toBeNull();
    });

    it('handles task triggers', () => {
      const taskSkill = new Skill({
        name: 'refactor',
        content: 'Refactor instructions',
        trigger: { type: 'task', triggers: ['/refactor'] },
      });

      const context = new AgentContext({ skills: [taskSkill] });
      const message: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'Please /refactor this code' }],
      };

      const result = context.getUserMessageSuffix(message);

      expect(result?.activatedSkillNames).toEqual(['refactor']);
      expect(result?.content.text).toContain('Refactor instructions');
    });
  });
});
