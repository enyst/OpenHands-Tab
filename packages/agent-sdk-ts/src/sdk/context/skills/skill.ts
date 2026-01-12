/**
 * Skill class and loading functions.
 * Transpiled from Python SDK: openhands/sdk/context/skills/skill.py
 */

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { homedir } from 'os';
import frontmatter from 'front-matter';
import type { InputMetadata, TriggerType } from './types';
import type { McpConfig, SkillResources } from './types';
import { SkillValidationError } from './exceptions';
import { discoverSkillResources, hasSkillResources } from './resources';
import { findMcpConfig, loadMcpConfig, validateMcpConfigObject } from './mcp';

// Regex pattern for valid AgentSkills names (strict):
// - 1-64 characters
// - lowercase alphanumeric + single hyphens only (a-z, 0-9, -)
// - must not start or end with hyphen
// - must not contain consecutive hyphens (--)
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Maximum characters for third-party skill files (e.g., AGENTS.md, CLAUDE.md, GEMINI.md).
// These files are always active, so we want to keep them reasonably sized.
const THIRD_PARTY_SKILL_MAX_CHARS = 10_000;

export { SkillValidationError } from './exceptions';

function maybeTruncate(content: string, truncateAfter: number, truncateNotice: string): string {
  if (!truncateAfter || truncateAfter < 0 || content.length <= truncateAfter) return content;

  if (truncateNotice.length >= truncateAfter) {
    return truncateNotice.slice(0, truncateAfter);
  }

  const availableChars = truncateAfter - truncateNotice.length;
  const proposedHead = Math.floor(availableChars / 2) + (availableChars % 2);

  const remaining = truncateAfter - truncateNotice.length;
  const headChars = Math.min(proposedHead, remaining);
  const tailChars = remaining - headChars;

  return content.slice(0, headChars) + truncateNotice + (tailChars > 0 ? content.slice(-tailChars) : '');
}

function findThirdPartyFiles(repoRoot: string): string[] {
  if (!existsSync(repoRoot)) return [];

  const targetNames = new Set(Object.keys(Skill.PATH_TO_THIRD_PARTY_SKILL_NAME).map((name) => name.toLowerCase()));
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
  mcpTools: McpConfig | null;
  resources: SkillResources | null;

  // Map third-party files to skill names
  public static readonly PATH_TO_THIRD_PARTY_SKILL_NAME: Record<string, string> = {
    '.cursorrules': 'cursorrules',
    'agents.md': 'agents',
    'agent.md': 'agents',
    'claude.md': 'claude',
    'gemini.md': 'gemini',
  };

  constructor(params: {
    name: string;
    content: string;
    trigger: TriggerType;
    source?: string | null;
    inputs?: InputMetadata[];
    isAgentSkillsFormat?: boolean;
    description?: string | null;
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
   * Handle third-party skill files (.cursorrules, agents.md, etc.)
   */
  private static handleThirdParty(path: string, fileContent: string): Skill | null {
    const baseName = basename(path).toLowerCase();
    const skillName = this.PATH_TO_THIRD_PARTY_SKILL_NAME[baseName];

    if (skillName) {
      const truncateNotice = `\n\n<TRUNCATED><NOTE>The file ${path} exceeded the maximum length (${THIRD_PARTY_SKILL_MAX_CHARS} characters) and has been truncated. Only the beginning and end are shown. You can read the full file if needed.</NOTE>\n\n`;
      const truncatedContent = maybeTruncate(fileContent, THIRD_PARTY_SKILL_MAX_CHARS, truncateNotice);

      if (fileContent.length > THIRD_PARTY_SKILL_MAX_CHARS) {
        console.warn(
          `Third-party skill file ${path} (${fileContent.length} chars) exceeded limit (${THIRD_PARTY_SKILL_MAX_CHARS} chars), truncating`,
        );
      }

      return new Skill({
        name: skillName,
        content: truncatedContent,
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

    const isSkillMd = basename(filePath).toLowerCase() === 'skill.md';

    // Calculate derived name from relative path if skillDir is provided
    let skillName: string;
    if (isSkillMd) {
      skillName = basename(dirname(filePath));
    } else if (skillDir) {
      const baseName = basename(filePath).toLowerCase();
      skillName =
        this.PATH_TO_THIRD_PARTY_SKILL_NAME[baseName] ??
        relative(skillDir, filePath).replace(/\.md$/, '');
    } else {
      skillName = basename(filePath, '.md');
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

    // Use name from frontmatter if provided, otherwise use derived name.
    // For AgentSkills-format SKILL.md, the derived name is the parent directory name.
    const name = (typeof metadata.name === 'string' && metadata.name.trim())
      ? metadata.name.trim()
      : skillName;

    // AgentSkills-format strict name validation (Python parity).
    if (isSkillMd) {
      const directoryName = skillName;
      const errors = validateAgentSkillName(name, directoryName);
      if (errors.length) {
        throw new SkillValidationError(`Invalid skill name '${name}': ${errors.join('; ')}`);
      }
    }

    const description = typeof metadata.description === 'string' ? metadata.description : null;

    // For AgentSkills-format SKILL.md, load .mcp.json + discover resources (Python parity).
    let mcpTools: McpConfig | null = null;
    let resources: SkillResources | null = null;
    if (isSkillMd) {
      const skillRoot = dirname(filePath);
      const mcpJsonPath = findMcpConfig(skillRoot);
      if (mcpJsonPath) {
        mcpTools = loadMcpConfig(mcpJsonPath, { skillRoot });
      }

      const discovered = discoverSkillResources(skillRoot);
      if (hasSkillResources(discovered)) {
        resources = discovered;
      }
    } else {
      // Legacy skills only use mcp_tools from frontmatter (not .mcp.json) (Python parity).
      const maybeMcpTools = metadata.mcp_tools;
      if (maybeMcpTools !== undefined) {
        if (typeof maybeMcpTools !== 'object' || maybeMcpTools === null || Array.isArray(maybeMcpTools)) {
          throw new SkillValidationError('mcp_tools must be a dictionary or None');
        }
        mcpTools = validateMcpConfigObject(maybeMcpTools);
      }
    }

    // Validate and parse trigger keywords from metadata
    const triggerMetadata = metadata.triggers;
    if (triggerMetadata && !Array.isArray(triggerMetadata)) {
      throw new SkillValidationError('Triggers must be a list of strings');
    }
    const keywords: string[] = Array.isArray(triggerMetadata)
      ? (triggerMetadata as string[])
      : [];

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
        isAgentSkillsFormat: isSkillMd,
        description,
        mcpTools,
        resources,
        trigger: { type: 'task', triggers: keywords },
        inputs,
      });
    } else if (keywords.length > 0) {
      return new Skill({
        name,
        content,
        source: filePath,
        isAgentSkillsFormat: isSkillMd,
        description,
        mcpTools,
        resources,
        trigger: { type: 'keyword', keywords },
      });
    } else {
      // No triggers, default to null (always active)
      return new Skill({
        name,
        content,
        source: filePath,
        isAgentSkillsFormat: isSkillMd,
        description,
        mcpTools,
        resources,
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
  agentSkills: Map<string, Skill>;
} {
  const repoSkills = new Map<string, Skill>();
  const knowledgeSkills = new Map<string, Skill>();
  const agentSkills = new Map<string, Skill>();

  // Get repo root (two levels up from skillDir)
  const repoRoot = join(skillDir, '..', '..');

  // Check for third-party rules: .cursorrules, AGENTS.md, CLAUDE.md, GEMINI.md, etc.
  const specialFiles = findThirdPartyFiles(repoRoot);

  const agentSkillMdFiles = findSkillMdDirectories(skillDir);
  const excludedDirs = new Set(agentSkillMdFiles.map((p) => dirname(p)));

  // Collect legacy .md files from skills directory if it exists
  const mdFiles: string[] = [...agentSkillMdFiles];
  if (existsSync(skillDir)) {
    const collectMarkdownFiles = (dir: string): void => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (excludedDirs.has(fullPath)) continue;
          collectMarkdownFiles(fullPath);
        } else if (entry.endsWith('.md') && entry !== 'README.md' && entry.toLowerCase() !== 'skill.md') {
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

function validateAgentSkillName(name: string, directoryName?: string): string[] {
  const errors: string[] = [];

  if (!name) {
    errors.push('Name cannot be empty');
    return errors;
  }

  if (name.length > 64) {
    errors.push(`Name exceeds 64 characters: ${name.length}`);
  }

  if (!SKILL_NAME_PATTERN.test(name)) {
    errors.push('Name must be lowercase alphanumeric with single hyphens (e.g., \'my-skill\', \'pdf-tools\')');
  }

  if (directoryName && name !== directoryName) {
    errors.push(`Name '${name}' does not match directory '${directoryName}'`);
  }

  return errors;
}

function findSkillMd(skillDir: string): string | null {
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) return null;
  const entries = readdirSync(skillDir);
  for (const entry of entries) {
    const fullPath = join(skillDir, entry);
    if (statSync(fullPath).isFile() && entry.toLowerCase() === 'skill.md') {
      return fullPath;
    }
  }
  return null;
}

function findSkillMdDirectories(skillsDir: string): string[] {
  const results: string[] = [];
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) return results;
  for (const entry of readdirSync(skillsDir)) {
    const fullPath = join(skillsDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    const skillMd = findSkillMd(fullPath);
    if (skillMd) results.push(skillMd);
  }
  return results;
}
