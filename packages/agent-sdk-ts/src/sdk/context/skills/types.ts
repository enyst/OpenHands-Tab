/**
 * Types and interfaces for the skills system.
 */

/**
 * Metadata for task skill inputs.
 */
export interface InputMetadata {
  /** Name of the input parameter */
  name: string;
  /** Description of the input parameter */
  description: string;
}

/**
 * Represents knowledge from a triggered skill.
 */
export interface SkillKnowledge {
  /** The name of the skill that was triggered */
  name: string;
  /** The word that triggered this skill */
  trigger: string;
  /** The actual content/knowledge from the skill */
  content: string;
}

/**
 * Base class for all trigger types.
 */
export interface BaseTrigger {
  type: string;
}

/**
 * Trigger for keyword-based skills.
 * These skills are activated when specific keywords appear in the user's query.
 */
export interface KeywordTrigger extends BaseTrigger {
  type: 'keyword';
  keywords: string[];
}

/**
 * Trigger for task-specific skills.
 * These skills are activated for specific task types and can modify prompts.
 */
export interface TaskTrigger extends BaseTrigger {
  type: 'task';
  triggers: string[];
}

/**
 * Union type for all trigger types.
 */
export type TriggerType = KeywordTrigger | TaskTrigger | null;
