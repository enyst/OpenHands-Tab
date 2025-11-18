/**
 * Skill class and loading functions.
 * Transpiled from Python SDK: openhands/sdk/context/skills/skill.py
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import frontmatter from 'front-matter';
import type { InputMetadata, KeywordTrigger, TaskTrigger, TriggerType } from './types';

/**
 * Error thrown when skill validation fails.
 */
export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

/**
 * A skill provides specialized knowledge or functionality.
 *
 * Skills use triggers to determine when they should be activated:
 * - null: Always active, for repository-specific guidelines
 * - KeywordTrigger: Activated when keywords appear in user messages
 * - TaskTrigger: Activated for specific tasks, may require user input
 */
export class Skill {
  name: string;
  content: string;
  trigger: TriggerType;
  source: string | null;
  inputs: InputMetadata[];

  // Map third-party files to skill names
  public static readonly PATH_TO_THIRD_PARTY_SKILL_NAME: Record<string, string> = {
    '.cursorrules': 'cursorrules',
    'agents.md': 'agents',
    'agent.md': 'agents',
  };

  constructor(params: {
    name: string;
    content: string;
    trigger: TriggerType;
    source?: string | null;
    inputs?: InputMetadata[];
  }) {
    this.name = params.name;
    this.content = params.content;
    this.trigger = params.trigger;
    this.source = params.source ?? null;
    this.inputs = params.inputs ?? [];

    // Append missing variables prompt for task skills
    if (this.trigger?.type === 'task' && this.requiresUserInput()) {
      const prompt =
        "\n\nIf the user didn't provide any of these variables, ask the user to " +
        'provide them first before the agent can proceed with the task.';
      if (!this.content.includes(prompt)) {
        this.content += prompt;
      }
    }
  }

  /**
   * Handle third-party skill files (.cursorrules, agents.md, etc.)
   */
  private static handleThirdParty(path: string, fileContent: string): Skill | null {
    const baseName = path.split('/').pop()?.toLowerCase() ?? '';
    const skillName = this.PATH_TO_THIRD_PARTY_SKILL_NAME[baseName];

    if (skillName) {
      return new Skill({
        name: skillName,
        content: fileContent,
        source: path,
        trigger: null,
      });
    }

    return null;
  }

  /**
   * Load a skill from a markdown file with frontmatter.
   */
  static load(params: { path: string; skillDir?: string | null; fileContent?: string | null }): Skill {
    const { path: filePath, skillDir, fileContent: providedContent } = params;

    // Calculate derived name from relative path if skillDir is provided
    let skillName: string;
    if (skillDir) {
      const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
      skillName =
        this.PATH_TO_THIRD_PARTY_SKILL_NAME[baseName] ??
        relative(skillDir, filePath).replace(/\.md$/, '');
    } else {
      skillName = filePath.split('/').pop()?.replace(/\.md$/, '') ?? 'unknown';
    }

    // Read file content if not provided
    const fileContent = providedContent ?? readFileSync(filePath, 'utf-8');

    // Handle third-party skill files
    const thirdPartySkill = this.handleThirdParty(filePath, fileContent);
    if (thirdPartySkill) {
      return thirdPartySkill;
    }

    // Parse frontmatter
    const parsed = frontmatter<Record<string, unknown>>(fileContent);
    const content = parsed.body;
    const metadata = parsed.attributes || {};

    // Use name from frontmatter if provided, otherwise use derived name
    const name = (metadata.name as string) ?? skillName;

    // Validate and parse trigger keywords from metadata
    const triggerMetadata = metadata.triggers;
    if (triggerMetadata && !Array.isArray(triggerMetadata)) {
      throw new SkillValidationError('Triggers must be a list of strings');
    }
    let keywords: string[] = Array.isArray(triggerMetadata) ? [...triggerMetadata] : [];

    // Infer the trigger type:
    // 1. If inputs exist -> TaskTrigger
    // 2. If keywords exist -> KeywordTrigger
    // 3. Else (no keywords) -> null (always active)
    if (metadata.inputs) {
      // Add a trigger for the skill name if not already present
      const triggerKeyword = `/${name}`;
      if (!keywords.includes(triggerKeyword)) {
        keywords.push(triggerKeyword);
      }

      // Validate inputs
      if (!Array.isArray(metadata.inputs)) {
        throw new SkillValidationError('inputs must be a list');
      }

      const inputs: InputMetadata[] = metadata.inputs.map((i: unknown) => {
        if (typeof i !== 'object' || !i || !('name' in i) || !('description' in i)) {
          throw new SkillValidationError('Invalid input metadata');
        }
        return i as InputMetadata;
      });

      return new Skill({
        name,
        content,
        source: filePath,
        trigger: { type: 'task', triggers: keywords },
        inputs,
      });
    } else if (keywords.length > 0) {
      return new Skill({
        name,
        content,
        source: filePath,
        trigger: { type: 'keyword', keywords },
      });
    } else {
      // No triggers, default to null (always active)
      return new Skill({
        name,
        content,
        source: filePath,
        trigger: null,
      });
    }
  }

  /**
   * Match a trigger in the message.
   * Returns the first trigger that matches the message, or null if no match.
   */
  matchTrigger(message: string): string | null {
    if (!this.trigger) {
      return null;
    }

    const messageLower = message.toLowerCase();

    if (this.trigger.type === 'keyword') {
      for (const keyword of this.trigger.keywords) {
        if (messageLower.includes(keyword.toLowerCase())) {
          return keyword;
        }
      }
    } else if (this.trigger.type === 'task') {
      for (const triggerStr of this.trigger.triggers) {
        if (messageLower.includes(triggerStr.toLowerCase())) {
          return triggerStr;
        }
      }
    }

    return null;
  }

  /**
   * Extract variables from the content.
   * Variables are in the format ${variable_name}.
   */
  extractVariables(): string[] {
    const pattern = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const matches: string[] = [];
    let match;
    while ((match = pattern.exec(this.content)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  /**
   * Check if this skill requires user input.
   * Returns true if the content contains variables in the format ${variable_name}.
   */
  requiresUserInput(): boolean {
    return this.extractVariables().length > 0 || this.inputs.length > 0;
  }
}

/**
 * Load all skills from the given directory.
 *
 * @param skillDir Path to the skills directory (e.g. .openhands/skills)
 * @returns Tuple of [repo_skills, knowledge_skills] Maps.
 *   repo_skills have trigger=null, knowledge_skills have KeywordTrigger or TaskTrigger.
 */
export function loadSkillsFromDir(skillDir: string): {
  repoSkills: Map<string, Skill>;
  knowledgeSkills: Map<string, Skill>;
} {
  const repoSkills = new Map<string, Skill>();
  const knowledgeSkills = new Map<string, Skill>();

  // Get repo root (two levels up from skillDir)
  const repoRoot = join(skillDir, '..', '..');

  // Check for third-party rules: .cursorrules, AGENTS.md, etc
  const specialFiles: string[] = [];
  for (const filename of Object.keys(Skill.PATH_TO_THIRD_PARTY_SKILL_NAME)) {
    for (const variant of [filename, filename.toLowerCase(), filename.toUpperCase()]) {
      const filePath = join(repoRoot, variant);
      if (existsSync(filePath)) {
        specialFiles.push(filePath);
        break; // Only add the first one found to avoid duplicates
      }
    }
  }

  // Collect .md files from skills directory if it exists
  const mdFiles: string[] = [];
  if (existsSync(skillDir)) {
    const collectMarkdownFiles = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collectMarkdownFiles(fullPath);
        } else if (entry.endsWith('.md') && entry !== 'README.md') {
          mdFiles.push(fullPath);
        }
      }
    };
    collectMarkdownFiles(skillDir);
  }

  // Process all files
  for (const file of [...specialFiles, ...mdFiles]) {
    try {
      const skill = Skill.load({ path: file, skillDir });
      if (skill.trigger === null) {
        repoSkills.set(skill.name, skill);
      } else {
        // KeywordTrigger and TaskTrigger skills
        knowledgeSkills.set(skill.name, skill);
      }
    } catch (e) {
      if (e instanceof SkillValidationError) {
        throw new SkillValidationError(`Error loading skill from ${file}: ${e.message}`);
      } else {
        throw new Error(`Error loading skill from ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { repoSkills, knowledgeSkills };
}

/**
 * Default user skills directories (in order of priority).
 */
export const USER_SKILLS_DIRS = [
  join(homedir(), '.openhands', 'skills'),
  join(homedir(), '.openhands', 'microagents'), // Legacy support
];

/**
 * Load skills from user's home directory.
 *
 * Searches for skills in ~/.openhands/skills/ and ~/.openhands/microagents/
 * (legacy). Skills from both directories are merged, with skills/ taking
 * precedence for duplicate names.
 *
 * @returns List of Skill objects loaded from user directories.
 *   Returns empty list if no skills found or loading fails.
 */
export function loadUserSkills(): Skill[] {
  const allSkills: Skill[] = [];
  const seenNames = new Set<string>();

  for (const skillsDir of USER_SKILLS_DIRS) {
    if (!existsSync(skillsDir)) {
      continue;
    }

    try {
      const { repoSkills, knowledgeSkills } = loadSkillsFromDir(skillsDir);

      // Merge repo and knowledge skills
      for (const skillsMap of [repoSkills, knowledgeSkills]) {
        for (const [name, skill] of skillsMap.entries()) {
          if (!seenNames.has(name)) {
            allSkills.push(skill);
            seenNames.add(name);
          }
        }
      }
    } catch (e) {
      // Log warning but don't throw - gracefully handle errors
      console.warn(`Failed to load user skills from ${skillsDir}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return allSkills;
}
