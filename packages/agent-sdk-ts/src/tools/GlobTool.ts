import fs from 'fs/promises';
import fsSync from 'node:fs';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { createGlobMatcher, expandHome, listFilesRecursively, normalizeGlobPattern, normalizeSlashes } from './searchUtils';
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

const resolveSearchRootAndPattern = (
  args: z.infer<typeof globArgsSchema>,
  context: ToolContext,
):
  | { mode: 'walk'; searchRoot: string; pattern: string }
  | { mode: 'file'; filePath: string } => {
  try {
    if (args.path) {
      return {
        mode: 'walk',
        searchRoot: context.workspace.resolvePath(expandHome(args.path)),
        pattern: normalizeGlobPattern(args.pattern),
      };
    }

    const expandedPattern = expandHome(args.pattern);
    if (!path.isAbsolute(expandedPattern)) {
      return { mode: 'walk', searchRoot: context.workspace.root, pattern: normalizeGlobPattern(args.pattern) };
    }

    const parsed = path.parse(expandedPattern);
    const root = parsed.root || path.sep;
    const remainder = expandedPattern.slice(root.length);
    const parts = remainder.split(/[\\/]+/).filter(Boolean);

    const searchParts: string[] = [];
    let sawMagic = false;
    for (const part of parts) {
      if (/[*?[\]{}()!]/.test(part)) {
        sawMagic = true;
        break;
      }
      searchParts.push(part);
    }

    const base = path.join(root, ...searchParts);
    const glob = parts.length > searchParts.length ? parts.slice(searchParts.length).join('/') : '**/*';
    const resolvedBase = context.workspace.resolvePath(base);

    if (!sawMagic && glob === '**/*') {
      try {
        if (fsSync.statSync(resolvedBase).isDirectory()) {
          return { mode: 'walk', searchRoot: resolvedBase, pattern: '**/*' };
        }
      } catch {
        // treat as a file pattern below
      }
      return { mode: 'file', filePath: resolvedBase };
    }

    return { mode: 'walk', searchRoot: resolvedBase, pattern: normalizeGlobPattern(glob) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid search path: ${detail}`);
  }
};

const getWalkOptions = (args: z.infer<typeof globArgsSchema>) => {
  const normalizedPattern = normalizeSlashes(expandHome(args.pattern));
  const normalizedPath = args.path ? normalizeSlashes(expandHome(args.path)) : '';

  const includeHidden =
    normalizedPattern.split('/').some((part) => part.startsWith('.'))
    || normalizedPath.split('/').some((part) => part.startsWith('.'));
  const includeNodeModules =
    normalizedPattern.includes('node_modules')
    || normalizedPath.split('/').some((part) => part === 'node_modules');

  return { includeHidden, includeNodeModules };
};

export class GlobTool extends ZodTool<z.infer<typeof globArgsSchema>, GlobResult> {
  readonly name = 'glob';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = globArgsSchema;

  async execute(args: z.infer<typeof globArgsSchema>, context: ToolContext): Promise<GlobResult> {
    const resolved = resolveSearchRootAndPattern(args, context);

    if (resolved.mode === 'file') {
      try {
        const stat = await fs.stat(resolved.filePath);
        if (!stat.isFile()) {
          return { files: [], pattern: args.pattern, searchPath: path.dirname(resolved.filePath), truncated: false };
        }
        return { files: [resolved.filePath], pattern: args.pattern, searchPath: path.dirname(resolved.filePath), truncated: false };
      } catch {
        return { files: [], pattern: args.pattern, searchPath: path.dirname(resolved.filePath), truncated: false };
      }
    }

    const { searchRoot, pattern } = resolved;
    const matcher = createGlobMatcher(pattern);
    const files = await listFilesRecursively(searchRoot, getWalkOptions(args));
    const filtered: string[] = [];

    for (const file of files) {
      const relative = normalizeSlashes(path.relative(searchRoot, file));
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
