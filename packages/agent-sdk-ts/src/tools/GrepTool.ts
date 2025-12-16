import fs from 'fs/promises';
import path from 'path';
import picomatch from 'picomatch';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export interface GrepResult {
  matches: string[];
  pattern: string;
  searchPath: string;
  includePattern?: string;
  truncated: boolean;
}

const grepArgsSchema = z.object({
  pattern: z.string().describe('The regex pattern to search for in file contents.'),
  path: z
    .string()
    .optional()
    .describe('The directory (absolute path) to search in. Defaults to the current working directory.'),
  include: z
    .string()
    .optional()
    .describe('Optional file pattern to filter which files to search (e.g., "*.js", "*.{ts,tsx}").'),
});

const TOOL_DESCRIPTION = `Fast content search tool.
* Searches file contents using regular expressions
* Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
* Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
* Returns matching file paths sorted by modification time.
* Only the first 100 results are returned. Consider narrowing your search with stricter regex patterns or provide path parameter if you need more results.
* Use this tool when you need to find files containing specific patterns.`;

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

const createMatcher = (pattern: string): ((value: string) => boolean) => {
  const matcher = picomatch(pattern, { dot: true }) as (value: string) => boolean;
  return (value: string) => Boolean(matcher(value));
};

export class GrepTool extends ZodTool<z.infer<typeof grepArgsSchema>, GrepResult> {
  readonly name = 'grep';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = grepArgsSchema;

  async execute(args: z.infer<typeof grepArgsSchema>, context: ToolContext): Promise<GrepResult> {
    const searchRoot = args.path ? context.workspace.resolvePath(args.path) : context.workspace.root;
    const includeMatcher = args.include ? createMatcher(normalizePattern(args.include)) : null;
    const files = await listFiles(searchRoot);
    const matches: { file: string; mtime: number }[] = [];
    let contentRegex: RegExp;
    try {
      contentRegex = new RegExp(args.pattern, 'i');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex pattern: ${detail}`);
    }

    for (const file of files) {
      const relative = normalize(path.relative(searchRoot, file));
      if (includeMatcher && !includeMatcher(relative)) continue;
      try {
        const content = await fs.readFile(file, 'utf8');
        if (contentRegex.test(content)) {
          const stat = await fs.stat(file);
          matches.push({ file, mtime: stat.mtimeMs });
        }
      } catch {
        // Ignore unreadable files
      }
    }

    const sorted = matches.sort((a, b) => b.mtime - a.mtime).map((item) => item.file);
    const truncated = matches.length > MAX_RESULTS;
    const limited = truncated ? sorted.slice(0, MAX_RESULTS) : sorted;

    return {
      matches: limited,
      pattern: args.pattern,
      searchPath: searchRoot,
      includePattern: args.include,
      truncated,
    };
  }
}
