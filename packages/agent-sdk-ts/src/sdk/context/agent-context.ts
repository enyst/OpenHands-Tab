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

  /** Whether to automatically load user skills from ~/.openhands/skills/ */
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
  getSystemMessageSuffix(options?: { secretNames?: string[] }): string | null {
    const repoSkills = this.skills.filter((s) => s.trigger === null);

    const parts: string[] = [];

    if (repoSkills.length) {
      const repoSkillContent = repoSkills
        .map((skill) => `[BEGIN context from [${skill.name}]]\n${skill.content}\n[END Context]`)
        .join('\n');
      parts.push(
        [
          '<REPO_CONTEXT>',
          "The following information has been included based on several files defined in user's repository.",
          'Please follow them while working.',
          '',
          repoSkillContent,
          '</REPO_CONTEXT>',
        ].join('\n'),
      );
    }

    const customSuffix = this.systemMessageSuffix?.trim();
    if (customSuffix) {
      parts.push(customSuffix);
    }

    const secretNames = (options?.secretNames ?? [])
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean);
    if (secretNames.length) {
      const normalizedSecretNames = Array.from(new Set(secretNames)).sort();
      const listedSecrets = normalizedSecretNames.map((name) => `* **$${name}**`).join('\n');
      parts.push(
        [
          '<CUSTOM_SECRETS>',
          '### Credential Access',
          '* Automatic secret injection: When you reference a registered secret key in your bash command, the secret value will be automatically exported as an environment variable before your command executes.',
          '* How to use secrets: Simply reference the secret key in your command (e.g., `echo ${GITHUB_TOKEN:0:8}` or `curl -H "Authorization: Bearer $API_KEY" https://api.example.com`). The system will detect the key name in your command text and export it as environment variable before it executes your command.',
          '* Secret detection: The system performs case-insensitive matching to find secret keys in your command text. If a registered secret key appears anywhere in your command, its value will be made available as an environment variable.',
          '* Security: Secret values are automatically masked in command output to prevent accidental exposure. You will see `***` instead of the actual secret value in the output.',
          '* Refreshing expired secrets: Some secrets (like GITHUB_TOKEN) may be updated periodically or expire over time. If a secret stops working (e.g., authentication failures), try using it again in a new command - the system should automatically use the refreshed value. For example, if GITHUB_TOKEN was used in a git remote URL and later expired, you can update the remote URL with the current token: `git remote set-url origin https://${GITHUB_TOKEN}@github.com/username/repo.git` to pick up the refreshed token value.',
          '* If it still fails, report it to the user.',
          '',
          'You have access to the following environment variables',
          listedSecrets,
          '</CUSTOM_SECRETS>',
        ].join('\n'),
      );
    }

    const suffix = parts.join('\n\n');
    return suffix || null;
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
      const knowledgeContent = recalledKnowledge
        .map(
          (agentInfo) =>
            `<EXTRA_INFO>\nThe following information has been included based on a keyword match for "${agentInfo.trigger}".\nIt may or may not be relevant to the user's request.\n\n${agentInfo.content}\n</EXTRA_INFO>`,
        )
        .join('\n\n');

      const formatted = [knowledgeContent, this.userMessageSuffix?.trim()]
        .filter(Boolean)
        .join('\n\n');

      return {
        content: { type: 'text', text: formatted },
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
