import type { Skill } from './skill';

const stripInvalidXmlChars = (value: string): string => {
  let result = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    // XML 1.0 valid chars:
    // - \t (0x9), \n (0xA), \r (0xD)
    // - 0x20..0xD7FF
    // - 0xE000..0xFFFD
    // - 0x10000..0x10FFFF
    if (codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD) {
      result += char;
      continue;
    }

    if (codePoint < 0x20) {
      continue;
    }

    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }

    if (codePoint === 0x7f || codePoint === 0xfffe || codePoint === 0xffff) {
      continue;
    }

    if (codePoint > 0x10ffff) {
      continue;
    }

    result += char;
  }
  return result;
};

const xmlEscape = (value: string): string =>
  stripInvalidXmlChars(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export function toPrompt(skills: Skill[], options?: { maxDescriptionLength?: number }): string {
  const maxDescriptionLength = options?.maxDescriptionLength ?? 200;

  if (skills.length === 0) {
    return '<available_skills>\n  no available skills\n</available_skills>';
  }

  const lines: string[] = ['<available_skills>'];

  for (const skill of skills) {
    let description = skill.description;
    let contentTruncated = 0;

    if (!description) {
      let charsBeforeDescription = 0;
      for (const line of skill.content.split('\n')) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith('#')) {
          charsBeforeDescription += line.length + 1;
          continue;
        }

        description = stripped;
        const descriptionEndPos = charsBeforeDescription + line.length;
        contentTruncated = Math.max(0, skill.content.length - descriptionEndPos);
        break;
      }
    }

    description = description ?? '';

    let totalTruncated = contentTruncated;

    if (description.length > maxDescriptionLength) {
      totalTruncated += description.length - maxDescriptionLength;
      description = description.slice(0, maxDescriptionLength);
    }

    if (totalTruncated > 0) {
      let truncationMessage = `... [${totalTruncated} characters truncated`;
      if (skill.source) {
        truncationMessage += `. View ${skill.source} for complete information`;
      }
      truncationMessage += ']';
      description = `${description}${truncationMessage}`;
    }

    const escapedDescription = xmlEscape(description.trim());
    const escapedName = xmlEscape(skill.name.trim());

    lines.push('  <skill>');
    lines.push(`    <name>${escapedName}</name>`);
    lines.push(`    <description>${escapedDescription}</description>`);
    if (skill.source) {
      lines.push(`    <location>${xmlEscape(skill.source.trim())}</location>`);
    }
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');
  return lines.join('\n');
}
