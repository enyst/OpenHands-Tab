/**
 * AgentContext - Central structure for managing prompt extension.
 * Transpiled from Python SDK: openhands/sdk/context/agent_context.py
 */

import type { Message, TextContent } from '../types';
import { Skill, SkillKnowledge, loadUserSkills } from './skills';

/**
 * AgentContext unifies all the contextual inputs that shape how the system
 * extends and interprets user prompts. It combines both static environment
 * details and dynamic, user-activated extensions from skills.
 *
 * Specifically, it provides:
 * - **Repository context / Repo Skills**: Information about the active codebase,
 *   branches, and repo-specific instructions contributed by repo skills.
 * - **Runtime context**: Current execution environment (hosts, working
 *   directory, secrets, date, etc.).
 * - **Conversation instructions**: Optional task- or channel-specific rules
 *   that constrain or guide the agent's behavior across the session.
 * - **Knowledge Skills**: Extensible components that can be triggered by user input
 *   to inject knowledge or domain-specific guidance.
 *
 * Together, these elements make AgentContext the primary container responsible
 * for assembling, formatting, and injecting all prompt-relevant context into
 * LLM interactions.
 */
export class AgentContext {
  /** List of available skills that can extend the user's input. */
  skills: Skill[];

  /** Optional suffix to append to the system prompt. */
  systemMessageSuffix?: string;

  /** Optional suffix to append to the user's message. */
  userMessageSuffix?: string;

  /** Whether to automatically load user skills from ~/.openhands/skills/ and ~/.openhands/microagents/ */
  loadUserSkills: boolean;

  constructor(params?: {
    skills?: Skill[];
    systemMessageSuffix?: string;
    userMessageSuffix?: string;
    loadUserSkills?: boolean;
  }) {
    this.skills = params?.skills ?? [];
    this.systemMessageSuffix = params?.systemMessageSuffix;
    this.userMessageSuffix = params?.userMessageSuffix;
    this.loadUserSkills = params?.loadUserSkills ?? false;

    // Validate no duplicate skill names
    const seen = new Set<string>();
    for (const skill of this.skills) {
      if (seen.has(skill.name)) {
        throw new Error(`Duplicate skill name found: ${skill.name}`);
      }
      seen.add(skill.name);
    }

    // Load user skills if enabled
    if (this.loadUserSkills) {
      try {
        const userSkills = loadUserSkills();
        // Merge user skills with explicit skills, avoiding duplicates
        const existingNames = new Set(this.skills.map((s) => s.name));
        for (const userSkill of userSkills) {
          if (!existingNames.has(userSkill.name)) {
            this.skills.push(userSkill);
          } else {
            console.warn(`Skipping user skill '${userSkill.name}' (already in explicit skills)`);
          }
        }
      } catch (e) {
        console.warn(`Failed to load user skills: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * Get the system message suffix with repo skill content and custom suffix.
   *
   * Custom suffix can typically include:
   * - Repository information (repo name, branch name, PR number, etc.)
   * - Runtime information (e.g., available hosts, current date)
   * - Conversation instructions (e.g., user preferences, task details)
   * - Repository-specific instructions (collected from repo skills)
   */
  getSystemMessageSuffix(): string | null {
    const repoSkills = this.skills.filter((s) => s.trigger === null);

    if (repoSkills.length > 0) {
      // Build the system message suffix with repo skills
      let formatted = '';

      // Add repo skill content
      for (const skill of repoSkills) {
        formatted += `\n\n## ${skill.name}\n\n${skill.content}`;
      }

      // Add custom suffix if provided
      if (this.systemMessageSuffix?.trim()) {
        formatted += `\n\n${this.systemMessageSuffix.trim()}`;
      }

      return formatted.trim();
    } else if (this.systemMessageSuffix?.trim()) {
      return this.systemMessageSuffix.trim();
    }

    return null;
  }

  /**
   * Augment the user's message with knowledge recalled from skills.
   *
   * This works by:
   * - Extracting the text content of the user message
   * - Matching skill triggers against the query
   * - Returning formatted knowledge and triggered skill names if relevant skills were triggered
   *
   * @param userMessage The user's message
   * @param skipSkillNames List of skill names to skip (already activated)
   * @returns Tuple of [TextContent, activated skill names] or null if no skills triggered
   */
  getUserMessageSuffix(
    userMessage: Message,
    skipSkillNames: string[] = []
  ): { content: TextContent; activatedSkillNames: string[] } | null {
    // Extract query from user message
    const query = userMessage.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    const recalledKnowledge: SkillKnowledge[] = [];

    // Skip empty queries, but still return userMessageSuffix if it exists
    if (!query) {
      if (this.userMessageSuffix?.trim()) {
        return {
          content: { type: 'text', text: this.userMessageSuffix.trim() },
          activatedSkillNames: [],
        };
      }
      return null;
    }

    // Search for skill triggers in the query
    for (const skill of this.skills) {
      const trigger = skill.matchTrigger(query);
      if (trigger && !skipSkillNames.includes(skill.name)) {
        console.log(`Skill '${skill.name}' triggered by keyword '${trigger}'`);
        recalledKnowledge.push({
          name: skill.name,
          trigger,
          content: skill.content,
        });
      }
    }

    if (recalledKnowledge.length > 0) {
      // Format triggered skills
      let formatted = '';
      for (const agentInfo of recalledKnowledge) {
        formatted += `<EXTRA_INFO>\n`;
        formatted += `The following information has been included based on a keyword match for "${agentInfo.trigger}".\n`;
        formatted += `It may or may not be relevant to the user's request.\n\n`;
        formatted += `${agentInfo.content}\n`;
        formatted += `</EXTRA_INFO>\n\n`;
      }

      // Add custom suffix if provided
      if (this.userMessageSuffix?.trim()) {
        formatted += this.userMessageSuffix.trim();
      }

      return {
        content: { type: 'text', text: formatted.trim() },
        activatedSkillNames: recalledKnowledge.map((k) => k.name),
      };
    }

    // No skills triggered, return custom suffix if provided
    if (this.userMessageSuffix?.trim()) {
      return {
        content: { type: 'text', text: this.userMessageSuffix.trim() },
        activatedSkillNames: [],
      };
    }

    return null;
  }
}
