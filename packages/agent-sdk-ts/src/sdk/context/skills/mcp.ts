import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { McpConfig, McpServerConfig } from './types';
import { SkillValidationError } from './exceptions';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') {
      return false;
    }
  }
  return true;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

export function findMcpConfig(skillRoot: string): string | null {
  const fullPath = join(resolve(skillRoot), '.mcp.json');
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return null;
  }
  return fullPath;
}

function expandMcpVariables(
  config: unknown,
  variables: Record<string, string>,
  env: Record<string, string | undefined>,
): unknown {
  const configStr = JSON.stringify(config);

  const escapeForJsonString = (value: string): string => JSON.stringify(value).slice(1, -1);

  const varPattern = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::-([^}]*))?\}/g;
  const expanded = configStr.replace(varPattern, (_match, name: string, defaultValue?: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return escapeForJsonString(variables[name]);
    }
    const envValue = env[name];
    if (typeof envValue === 'string') {
      return escapeForJsonString(envValue);
    }
    if (typeof defaultValue === 'string') {
      // Default is captured from JSON.stringify output, so it is already JSON-escaped.
      return defaultValue;
    }
    return _match;
  });

  return JSON.parse(expanded) as unknown;
}

function validateMcpServerConfig(serverName: string, value: unknown): McpServerConfig {
  if (!isRecord(value)) {
    throw new SkillValidationError(`Invalid MCP server '${serverName}': expected object`);
  }

  const type = typeof value.type === 'string' ? value.type : undefined;
  const command = typeof value.command === 'string' ? value.command : undefined;
  const url = typeof value.url === 'string' ? value.url : undefined;
  const args = value.args === undefined ? undefined : value.args;
  const env = value.env === undefined ? undefined : value.env;
  const headers = value.headers === undefined ? undefined : value.headers;
  const cwd = value.cwd === undefined ? undefined : value.cwd;

  if (!command && !url) {
    throw new SkillValidationError(
      `Invalid MCP server '${serverName}': expected 'command' (stdio) or 'url' (http/sse)`,
    );
  }

  if (args !== undefined && !isStringArray(args)) {
    throw new SkillValidationError(`Invalid MCP server '${serverName}': 'args' must be a string[]`);
  }

  if (env !== undefined && !isStringRecord(env)) {
    throw new SkillValidationError(`Invalid MCP server '${serverName}': 'env' must be a record<string,string>`);
  }

  if (headers !== undefined && !isStringRecord(headers)) {
    throw new SkillValidationError(`Invalid MCP server '${serverName}': 'headers' must be a record<string,string>`);
  }

  if (cwd !== undefined && typeof cwd !== 'string') {
    throw new SkillValidationError(`Invalid MCP server '${serverName}': 'cwd' must be a string`);
  }

  return {
    type,
    command,
    args: isStringArray(args) ? args : undefined,
    env: isStringRecord(env) ? env : undefined,
    cwd: typeof cwd === 'string' ? cwd : undefined,
    url,
    headers: isStringRecord(headers) ? headers : undefined,
  };
}

export function validateMcpConfigObject(value: unknown): McpConfig {
  if (!isRecord(value)) {
    throw new SkillValidationError(`Invalid .mcp.json format: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
  }

  if (!('mcpServers' in value)) {
    throw new SkillValidationError("Invalid MCP configuration: missing required key 'mcpServers'");
  }

  const serversRaw = value.mcpServers;
  if (!isRecord(serversRaw)) {
    throw new SkillValidationError("Invalid MCP configuration: 'mcpServers' must be an object");
  }

  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(serversRaw)) {
    if (!name.trim()) {
      throw new SkillValidationError('Invalid MCP configuration: mcpServers contains an empty key');
    }
    mcpServers[name] = validateMcpServerConfig(name, cfg);
  }

  return { mcpServers };
}

export function loadMcpConfig(mcpJsonPath: string, options?: { skillRoot?: string }): McpConfig {
  const resolvedPath = resolve(mcpJsonPath);

  let config: unknown;
  try {
    config = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SkillValidationError(`Invalid JSON in ${resolvedPath}: ${message}`);
  }

  const variables: Record<string, string> = {};
  if (options?.skillRoot) {
    variables.SKILL_ROOT = resolve(options.skillRoot);
  }

  const expanded = expandMcpVariables(config, variables, process.env);
  return validateMcpConfigObject(expanded);
}
