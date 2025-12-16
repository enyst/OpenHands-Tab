import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { createGlobMatcher, expandHome, listFilesRecursively, normalizeGlobPattern, normalizeSlashes } from './searchUtils';
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
    .describe('The directory (absolute or workspace-relative path) to search in. Defaults to the current working directory. Must be within the allowed workspace roots.'),
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

export class GrepTool extends ZodTool<z.infer<typeof grepArgsSchema>, GrepResult> {
  readonly name = 'grep';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = grepArgsSchema;

  async execute(args: z.infer<typeof grepArgsSchema>, context: ToolContext): Promise<GrepResult> {
    let searchRoot: string;
    try {
      searchRoot = args.path ? context.workspace.resolvePath(expandHome(args.path)) : context.workspace.root;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid search path: ${detail}`);
    }
    const includeMatcher = args.include ? createGlobMatcher(normalizeGlobPattern(args.include)) : null;
    const files = await listFilesRecursively(searchRoot);
    const matches: { file: string; mtime: number }[] = [];
    let contentRegex: RegExp;
    try {
      contentRegex = new RegExp(args.pattern, 'm');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex pattern: ${detail}`);
    }

    for (const file of files) {
      const relative = normalizeSlashes(path.relative(searchRoot, file));
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
