/**
 * Skill class and loading functions.
 * Transpiled from Python SDK: openhands/sdk/context/skills/skill.py
 */

import { existsSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import type { InputMetadata, TriggerType } from './types';
import type { McpConfig, SkillResources } from './types';
import { SkillValidationError } from './exceptions';
import { collectLegacyMarkdownFiles, findSkillMdDirectories, findThirdPartyFiles } from './skillDiscovery';
import { parseSkillFile, PATH_TO_THIRD_PARTY_SKILL_NAME } from './skillParsing';

export { SkillValidationError } from './exceptions';

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
  isAgentSkillsFormat: boolean;
  description: string | null;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string> | null;
  allowedTools: string[] | null;
  mcpTools: McpConfig | null;
  resources: SkillResources | null;

  // Map third-party files to skill names
  public static readonly PATH_TO_THIRD_PARTY_SKILL_NAME: Record<string, string> = PATH_TO_THIRD_PARTY_SKILL_NAME;

  constructor(params: {
    name: string;
    content: string;
    trigger: TriggerType;
    source?: string | null;
    inputs?: InputMetadata[];
    isAgentSkillsFormat?: boolean;
    description?: string | null;
    license?: string | null;
    compatibility?: string | null;
    metadata?: Record<string, string> | null;
    allowedTools?: string[] | null;
    mcpTools?: McpConfig | null;
    resources?: SkillResources | null;
  }) {
    this.name = params.name;
    this.content = params.content;
    this.trigger = params.trigger;
    this.source = params.source ?? null;
    this.inputs = params.inputs ?? [];
    this.isAgentSkillsFormat = params.isAgentSkillsFormat ?? false;
    this.description = params.description ?? null;
    this.license = params.license ?? null;
    this.compatibility = params.compatibility ?? null;
    this.metadata = params.metadata ?? null;
    this.allowedTools = params.allowedTools ?? null;
    this.mcpTools = params.mcpTools ?? null;
    this.resources = params.resources ?? null;

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
   * Load a skill from a markdown file with frontmatter.
   */
  static load(params: { path: string; skillDir?: string | null; fileContent?: string | null }): Skill {
    const { path: filePath, skillDir, fileContent: providedContent } = params;
    const fileContent = providedContent ?? readFileSync(filePath, 'utf-8');
    const parsed = parseSkillFile({ filePath, skillDir, fileContent });
    return new Skill({
      ...parsed,
      source: filePath,
    });
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
  agentSkills: Map<string, Skill>;
} {
  const repoSkills = new Map<string, Skill>();
  const knowledgeSkills = new Map<string, Skill>();
  const agentSkills = new Map<string, Skill>();

  // Get repo root (two levels up from skillDir)
  const repoRoot = join(skillDir, '..', '..');

  // Check for third-party rules: .cursorrules, AGENTS.md, CLAUDE.md, GEMINI.md, etc.
  const specialFiles = findThirdPartyFiles(repoRoot, Skill.PATH_TO_THIRD_PARTY_SKILL_NAME);

  const agentSkillMdFiles = findSkillMdDirectories(skillDir);
  const excludedDirs = new Set(agentSkillMdFiles.map((p) => dirname(p)));

  // Collect legacy .md files from skills directory if it exists.
  const mdFiles: string[] = [
    ...agentSkillMdFiles,
    ...collectLegacyMarkdownFiles(skillDir, excludedDirs),
  ];

  // Process all files
  for (const file of [...specialFiles, ...mdFiles]) {
    try {
      const skill = Skill.load({ path: file, skillDir });
      const isSkillMd = basename(file).toLowerCase() === 'skill.md';
      if (isSkillMd) {
        agentSkills.set(skill.name, skill);
      } else if (skill.trigger === null) {
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

  return { repoSkills, knowledgeSkills, agentSkills };
}

/**
 * Default user skills directories (in order of priority).
 */
export const USER_SKILLS_DIRS = [
  join(homedir(), '.openhands', 'skills'),
];

/**
 * Load skills from user's home directory.
 *
 * Searches for skills in ~/.openhands/skills/.
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
      const { repoSkills, knowledgeSkills, agentSkills } = loadSkillsFromDir(skillsDir);

      // Merge repo, knowledge, and agent skills (AgentSkills format)
      for (const skillsMap of [repoSkills, knowledgeSkills, agentSkills]) {
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
