import fs from 'fs/promises';
import path from 'path';
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
    .describe('The glob pattern to match files (e.g., "**/*.js", "src/**/*.ts").'),
  path: z
    .string()
    .optional()
    .describe('The directory (absolute path) to search in. Defaults to the current working directory.'),
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

const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
};

const listFiles = async (root: string): Promise<string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
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

export class GlobTool extends ZodTool<z.infer<typeof globArgsSchema>, GlobResult> {
  readonly name = 'glob';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = globArgsSchema;

  async execute(args: z.infer<typeof globArgsSchema>, context: ToolContext): Promise<GlobResult> {
    const searchRoot = args.path ? context.workspace.resolvePath(args.path) : context.workspace.root;
    const regex = globToRegExp(args.pattern);
    const files = await listFiles(searchRoot);
    const filtered: string[] = [];

    for (const file of files) {
      const relative = path.relative(searchRoot, file);
      if (regex.test(relative)) {
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

