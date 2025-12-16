import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import picomatch from 'picomatch';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export interface GlobResult {
  files: string[];
  pattern: string;
  searchPath: string;
  truncated: boolean;
}

const globArgsSchema = z.object({
  pattern: z
    .string()
    .describe('The glob pattern to match files (e.g., "**/*.js", "src/**/*.ts"). May also be an absolute path pattern under the allowed workspace roots.'),
  path: z
    .string()
    .optional()
    .describe('The directory (absolute or workspace-relative path) to search in. Defaults to the current working directory. Must be within the allowed workspace roots.'),
});

const TOOL_DESCRIPTION = `Fast file pattern matching tool.
* Supports glob patterns like "**/*.js" or "src/**/*.ts"
* Use this tool when you need to find files by name patterns
* Returns matching file paths sorted by modification time
* Only the first 100 results are returned. Consider narrowing your search with stricter glob patterns or provide path parameter if you need more results.

Examples:
- Find all JavaScript files: "**/*.js"
- Find TypeScript files in src: "src/**/*.ts"
- Find Python test files: "**/test_*.py"
- Find configuration files: "**/*.{json,yaml,yml,toml}"`;

const MAX_RESULTS = 100;

const shouldSkipEntry = (name: string): boolean => name.startsWith('.') || name === 'node_modules';

const listFiles = async (root: string): Promise<string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const child = await listFiles(fullPath);
      results.push(...child);
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

const normalize = (p: string): string => p.split(path.sep).join('/');

const normalizePattern = (pattern: string): string => {
  const cleaned = normalize(pattern.trim());
  if (!cleaned) return '**/*';
  if (cleaned.includes('/')) return cleaned;
  return cleaned.startsWith('**/') ? cleaned : `**/${cleaned}`;
};

const expandHome = (input: string): string => {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

const resolveSearchRootAndPattern = (
  args: z.infer<typeof globArgsSchema>,
  context: ToolContext,
): { searchRoot: string; pattern: string } => {
  if (args.path) {
    return { searchRoot: context.workspace.resolvePath(args.path), pattern: normalizePattern(args.pattern) };
  }

  const expandedPattern = expandHome(args.pattern);
  if (!path.isAbsolute(expandedPattern)) {
    return { searchRoot: context.workspace.root, pattern: normalizePattern(args.pattern) };
  }

  const parsed = path.parse(expandedPattern);
  const root = parsed.root || path.sep;
  const remainder = expandedPattern.slice(root.length);
  const parts = remainder.split(/[\\/]+/).filter(Boolean);

  const searchParts: string[] = [];
  for (const part of parts) {
    if (/[*?[\]{}()!]/.test(part)) break;
    searchParts.push(part);
  }

  const base = path.join(root, ...searchParts);
  const glob = parts.length > searchParts.length ? parts.slice(searchParts.length).join('/') : '**/*';
  return { searchRoot: context.workspace.resolvePath(base), pattern: normalizePattern(glob) };
};

const createMatcher = (pattern: string): ((value: string) => boolean) => {
  const matcher = picomatch(pattern, { dot: true }) as (value: string) => boolean;
  return (value: string) => Boolean(matcher(value));
};

export class GlobTool extends ZodTool<z.infer<typeof globArgsSchema>, GlobResult> {
  readonly name = 'glob';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = globArgsSchema;

  async execute(args: z.infer<typeof globArgsSchema>, context: ToolContext): Promise<GlobResult> {
    const { searchRoot, pattern } = resolveSearchRootAndPattern(args, context);
    const matcher = createMatcher(pattern);
    const files = await listFiles(searchRoot);
    const filtered: string[] = [];

    for (const file of files) {
      const relative = normalize(path.relative(searchRoot, file));
      if (matcher(relative)) {
        filtered.push(file);
      }
    }

    const withStats = await Promise.all(
      filtered.map(async (file) => ({ file, mtime: (await fs.stat(file)).mtimeMs })),
    );

    const sorted = withStats.sort((a, b) => b.mtime - a.mtime).map((item) => item.file);
    const truncated = sorted.length > MAX_RESULTS;
    const limited = truncated ? sorted.slice(0, MAX_RESULTS) : sorted;

    return {
      files: limited,
      pattern: args.pattern,
      searchPath: searchRoot,
      truncated,
    };
  }
}
