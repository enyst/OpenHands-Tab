import { basename, dirname, relative } from 'path';
import frontmatter from 'front-matter';
import type { InputMetadata, TriggerType } from './types';
import type { McpConfig, SkillResources } from './types';
import { SkillValidationError } from './exceptions';
import { discoverSkillResources, hasSkillResources } from './resources';
import { findMcpConfig, loadMcpConfig, validateMcpConfigObject } from './mcp';
import { maybeTruncate, THIRD_PARTY_SKILL_MAX_CHARS, validateAgentSkillName } from './skillValidation';

export const PATH_TO_THIRD_PARTY_SKILL_NAME: Record<string, string> = {
  '.cursorrules': 'cursorrules',
  'agents.md': 'agents',
  'agent.md': 'agents',
  'claude.md': 'claude',
  'gemini.md': 'gemini',
};

export type ParsedSkillFile = {
  name: string;
  content: string;
  trigger: TriggerType;
  inputs: InputMetadata[];
  isAgentSkillsFormat: boolean;
  description: string | null;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, string> | null;
  allowedTools: string[] | null;
  mcpTools: McpConfig | null;
  resources: SkillResources | null;
};

function deriveSkillName(filePath: string, skillDir?: string | null): { isSkillMd: boolean; skillName: string } {
  const isSkillMd = basename(filePath).toLowerCase() === 'skill.md';

  if (isSkillMd) {
    return { isSkillMd, skillName: basename(dirname(filePath)) };
  }

  if (skillDir) {
    const baseName = basename(filePath).toLowerCase();
    return {
      isSkillMd,
      skillName: PATH_TO_THIRD_PARTY_SKILL_NAME[baseName] ?? relative(skillDir, filePath).replace(/\.md$/, ''),
    };
  }

  return { isSkillMd, skillName: basename(filePath, '.md') };
}

function parseStringMetadataField(
  metadata: Record<string, unknown>,
  key: 'description' | 'license' | 'compatibility',
): string | null {
  const rawValue = metadata[key];
  if (rawValue !== undefined && rawValue !== null && typeof rawValue !== 'string') {
    throw new SkillValidationError(`${key} must be a string`);
  }

  if (typeof rawValue !== 'string') {
    return null;
  }

  const normalized = key === 'description' ? rawValue : rawValue.trim();
  if (key === 'description' && normalized.length > 1024) {
    throw new SkillValidationError(`description must be <= 1024 characters (got ${normalized.length})`);
  }

  return normalized;
}

function parseSkillMetadataObject(metadata: Record<string, unknown>): Record<string, string> | null {
  const rawMetadata = metadata.metadata;
  if (rawMetadata !== undefined && rawMetadata !== null) {
    if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      throw new SkillValidationError('metadata must be a dictionary');
    }
  }

  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(rawMetadata as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
  );
}

function parseAllowedTools(metadata: Record<string, unknown>): string[] | null {
  const allowedToolsRaw = metadata['allowed-tools'] ?? metadata.allowed_tools;
  if (allowedToolsRaw !== undefined && allowedToolsRaw !== null) {
    if (typeof allowedToolsRaw !== 'string' && !Array.isArray(allowedToolsRaw)) {
      throw new SkillValidationError('allowed-tools must be a string or list of strings');
    }
    if (Array.isArray(allowedToolsRaw) && !allowedToolsRaw.every((t) => typeof t === 'string')) {
      throw new SkillValidationError('allowed-tools must be a string or list of strings');
    }
  }

  if (typeof allowedToolsRaw === 'string') {
    return allowedToolsRaw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  }

  if (Array.isArray(allowedToolsRaw)) {
    return allowedToolsRaw.map((t) => t.trim()).filter(Boolean);
  }

  return null;
}

function parseTriggerKeywords(metadata: Record<string, unknown>): string[] {
  const triggerMetadata = metadata.triggers;
  if (triggerMetadata && !Array.isArray(triggerMetadata)) {
    throw new SkillValidationError('Triggers must be a list of strings');
  }

  return Array.isArray(triggerMetadata)
    ? (triggerMetadata as string[])
    : [];
}

function parseTaskInputs(
  metadata: Record<string, unknown>,
  name: string,
  keywords: string[],
): InputMetadata[] {
  const triggerKeyword = `/${name}`;
  if (!keywords.includes(triggerKeyword)) {
    keywords.push(triggerKeyword);
  }

  if (!Array.isArray(metadata.inputs)) {
    throw new SkillValidationError('inputs must be a list');
  }

  return metadata.inputs.map((i: unknown) => {
    if (typeof i !== 'object' || !i || !('name' in i) || !('description' in i)) {
      throw new SkillValidationError('Invalid input metadata');
    }
    return i as InputMetadata;
  });
}

export function parseSkillFile(params: {
  filePath: string;
  skillDir?: string | null;
  fileContent: string;
}): ParsedSkillFile {
  const { filePath, skillDir, fileContent } = params;

  const { isSkillMd, skillName } = deriveSkillName(filePath, skillDir);
  const thirdPartySkillName = PATH_TO_THIRD_PARTY_SKILL_NAME[basename(filePath).toLowerCase()];

  if (thirdPartySkillName) {
    const truncateNotice = `\n\n<TRUNCATED><NOTE>The file ${filePath} exceeded the maximum length (${THIRD_PARTY_SKILL_MAX_CHARS} characters) and has been truncated. Only the beginning and end are shown. You can read the full file if needed.</NOTE>\n\n`;
    const truncatedContent = maybeTruncate(fileContent, THIRD_PARTY_SKILL_MAX_CHARS, truncateNotice);

    if (fileContent.length > THIRD_PARTY_SKILL_MAX_CHARS) {
      console.warn(
        `Third-party skill file ${filePath} (${fileContent.length} chars) exceeded limit (${THIRD_PARTY_SKILL_MAX_CHARS} chars), truncating`,
      );
    }

    return {
      name: thirdPartySkillName,
      content: truncatedContent,
      trigger: null,
      inputs: [],
      isAgentSkillsFormat: false,
      description: null,
      license: null,
      compatibility: null,
      metadata: null,
      allowedTools: null,
      mcpTools: null,
      resources: null,
    };
  }

  const parsed = frontmatter<Record<string, unknown>>(fileContent);
  const content = parsed.body;
  const metadata = parsed.attributes || {};

  const name = (typeof metadata.name === 'string' && metadata.name.trim())
    ? metadata.name.trim()
    : skillName;

  if (isSkillMd) {
    const directoryName = skillName;
    const errors = validateAgentSkillName(name, directoryName);
    if (errors.length) {
      throw new SkillValidationError(`Invalid skill name '${name}': ${errors.join('; ')}`);
    }
  }

  const description = parseStringMetadataField(metadata, 'description');
  const license = parseStringMetadataField(metadata, 'license');
  const compatibility = parseStringMetadataField(metadata, 'compatibility');
  const skillMetadata = parseSkillMetadataObject(metadata);
  const allowedTools = parseAllowedTools(metadata);

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
    const maybeMcpTools = metadata.mcp_tools;
    if (maybeMcpTools !== undefined) {
      if (typeof maybeMcpTools !== 'object' || maybeMcpTools === null || Array.isArray(maybeMcpTools)) {
        throw new SkillValidationError('mcp_tools must be a dictionary or None');
      }
      mcpTools = validateMcpConfigObject(maybeMcpTools);
    }
  }

  const keywords = parseTriggerKeywords(metadata);
  if (metadata.inputs) {
    const inputs = parseTaskInputs(metadata, name, keywords);
    return {
      name,
      content,
      trigger: { type: 'task', triggers: keywords },
      inputs,
      isAgentSkillsFormat: isSkillMd,
      description,
      license,
      compatibility,
      metadata: skillMetadata,
      allowedTools,
      mcpTools,
      resources,
    };
  }

  if (keywords.length > 0) {
    return {
      name,
      content,
      trigger: { type: 'keyword', keywords },
      inputs: [],
      isAgentSkillsFormat: isSkillMd,
      description,
      license,
      compatibility,
      metadata: skillMetadata,
      allowedTools,
      mcpTools,
      resources,
    };
  }

  return {
    name,
    content,
    trigger: null,
    inputs: [],
    isAgentSkillsFormat: isSkillMd,
    description,
    license,
    compatibility,
    metadata: skillMetadata,
    allowedTools,
    mcpTools,
    resources,
  };
}
