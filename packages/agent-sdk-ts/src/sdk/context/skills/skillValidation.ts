const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Maximum characters for third-party skill files (e.g., AGENTS.md, CLAUDE.md, GEMINI.md).
 * These files are always active, so we keep them reasonably sized.
 */
export const THIRD_PARTY_SKILL_MAX_CHARS = 10_000;

export function maybeTruncate(content: string, truncateAfter: number, truncateNotice: string): string {
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

export function validateAgentSkillName(name: string, directoryName?: string): string[] {
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
