import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool, booleanWithDefault } from './zod-tool';

const execFileAsync = promisify(execFile);
const AGENT_BROWSER_BIN_ENV = 'SMOLPAWS_AGENT_BROWSER_BIN';
const AGENT_BROWSER_TIMEOUT_MS = 30_000;
const DEFAULT_SCROLL_DISTANCE = '800';
const snapshotRefsByWorkspace = new WeakMap<object, string[]>();

export interface BrowserUseResult {
  action: string;
  request: Record<string, unknown>;
  commands: string[][];
  output: string;
  refs?: string[];
  note?: string;
}

type BrowserCommandResult = {
  command: string[];
  stdout: string;
  stderr: string;
  output: string;
};

type PreparedBrowserInvocation = {
  commands: string[][];
  invalidateCachedRefs?: boolean;
  note?: string;
  transform?: (results: BrowserCommandResult[], context: ToolContext) => Pick<BrowserUseResult, 'output' | 'refs' | 'note'>;
};

const navigateSchema = z.object({
  url: z.string().url().describe('The URL to navigate to'),
  new_tab: booleanWithDefault(false).describe('Whether to open in a new tab. Default: false'),
});

const clickSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .describe('The zero-based element index from the latest browser_get_state output.'),
  new_tab: booleanWithDefault(false).describe(
    'Whether to open any resulting navigation in a new tab. Default: false',
  ),
});

const typeSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .describe('The zero-based input index from the latest browser_get_state output.'),
  text: z.string().describe('The text to type.'),
});

const getStateSchema = z.object({
  include_screenshot: booleanWithDefault(false).describe(
    'Whether to include a screenshot of the current page. Default: false',
  ),
});

const getContentSchema = z.object({
  extract_links: booleanWithDefault(false).describe('Whether to include links in the content (default: false).'),
  start_from_char: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Character index to start from in the page content (default: 0).'),
});

const scrollSchema = z.object({
  direction: z.enum(['up', 'down']).default('down').describe("Direction to scroll - 'up' or 'down'. Default: 'down'."),
});

const goBackSchema = z.object({});
const listTabsSchema = z.object({});

const switchTabSchema = z.object({
  tab_id: z.string().describe('4 Character Tab ID of the tab to switch to.'),
});

const closeTabSchema = z.object({
  tab_id: z.string().describe('4 Character Tab ID of the tab to close.'),
});

const BROWSER_NAVIGATE_DESCRIPTION = `Navigate to a URL in the local agent-browser session.

This uses the local \`agent-browser\` CLI instead of the Python upstream's Docker-first \`browser_use\` path.
The \`new_tab\` flag is accepted for compatibility but ignored because the local CLI currently drives one browser session.`;

const BROWSER_CLICK_DESCRIPTION = `Click an element in the local browser session.

Call \`browser_get_state\` first. This tool maps the requested zero-based index from that latest snapshot to the underlying \`agent-browser\` ref (for example \`@e2\`).`;

const BROWSER_TYPE_DESCRIPTION = `Fill an input in the local browser session.

Call \`browser_get_state\` first. This tool maps the requested zero-based index from that latest snapshot to the underlying \`agent-browser\` ref and then fills it with the provided text.`;

const BROWSER_GET_STATE_DESCRIPTION = `Capture the current local browser state using \`agent-browser snapshot -i\`.

The returned output includes the raw snapshot and caches the ref order so later \`browser_click\` and \`browser_type\` calls can keep their Python-compatible index-based schema.`;

const BROWSER_GET_CONTENT_DESCRIPTION = `Capture a compact page snapshot from the local browser session.

This currently uses \`agent-browser snapshot -c\`. \`extract_links\` is accepted for compatibility but does not change the local output format.`;

const BROWSER_SCROLL_DESCRIPTION = `Scroll the page in the local browser session.

This maps to \`agent-browser scroll <direction> 800\`.`;

const BROWSER_GO_BACK_DESCRIPTION = `Go back to the previous page in the local browser session.`;

const BROWSER_LIST_TABS_DESCRIPTION = `Inspect the current local browser session.

The local \`agent-browser\` path currently exposes one active browser session rather than Python-style tab ids, so this returns a synthetic single-item listing.`;

const BROWSER_SWITCH_TAB_DESCRIPTION = `Switching tabs is not supported by the local \`agent-browser\` path yet.`;

const BROWSER_CLOSE_TAB_DESCRIPTION = `Closing a specific tab is not supported by the local \`agent-browser\` path yet.`;

function resolveAgentBrowserBinary(): string {
  const configured = process.env[AGENT_BROWSER_BIN_ENV]?.trim();
  return configured && configured.length > 0 ? configured : 'agent-browser';
}

function parseSnapshotRefs(output: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const match of output.matchAll(/(?:@|ref=)(e[\w-]+)/g)) {
    const ref = `@${match[1]}`;
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function combineNotes(...notes: Array<string | undefined>): string | undefined {
  const combined = notes
    .map((note) => note?.trim())
    .filter((note): note is string => Boolean(note));
  return combined.length > 0 ? combined.join('\n') : undefined;
}

function resolveRefForIndex(index: number, context: ToolContext): string {
  const refs = snapshotRefsByWorkspace.get(context.workspace as object) ?? [];
  const ref = refs[index];
  if (!ref) {
    throw new Error(
      `No cached browser_get_state ref for index ${index}. Call browser_get_state before browser interactions.`,
    );
  }
  return ref;
}

async function runAgentBrowserCommand(
  commandArgs: string[],
  context: ToolContext,
): Promise<BrowserCommandResult> {
  const binary = resolveAgentBrowserBinary();
  try {
    const result = await execFileAsync(binary, commandArgs, {
      cwd: context.workspace.root,
      maxBuffer: 10 * 1024 * 1024,
      timeout: AGENT_BROWSER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    return {
      command: [binary, ...commandArgs],
      stdout,
      stderr,
      output: output || `Executed ${[binary, ...commandArgs].join(' ')}`,
    };
  } catch (error) {
    const err = error as {
      code?: string;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (err.code === 'ENOENT') {
      throw new Error(
        `agent-browser CLI not found. Install it and ensure it is on PATH, or set ${AGENT_BROWSER_BIN_ENV}.`,
      );
    }
    if (err.killed || err.signal === 'SIGKILL') {
      throw new Error(`agent-browser command timed out after 30s: ${commandArgs.join(' ')}`);
    }
    const details = [err.stdout?.trim(), err.stderr?.trim(), err.message?.trim()]
      .filter(Boolean)
      .join('\n');
    throw new Error(details || `agent-browser command failed: ${commandArgs.join(' ')}`);
  }
}

abstract class BaseBrowserUseTool extends ZodTool<Record<string, unknown>, BrowserUseResult> {
  protected abstract prepareExecution(
    args: Record<string, unknown>,
    context: ToolContext,
  ): PreparedBrowserInvocation;

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<BrowserUseResult> {
    const prepared = this.prepareExecution(args, context);
    if (prepared.invalidateCachedRefs) {
      snapshotRefsByWorkspace.delete(context.workspace as object);
    }
    const results: BrowserCommandResult[] = [];
    const commands: string[][] = [];
    for (const commandArgs of prepared.commands) {
      const result = await runAgentBrowserCommand(commandArgs, context);
      commands.push(result.command);
      results.push(result);
    }
    const transformed = prepared.transform?.(results, context) ?? {
      output: results
        .map((result) => result.output)
        .filter(Boolean)
        .join('\n\n'),
    };
    return {
      action: this.name,
      request: args,
      commands,
      output: transformed.output,
      refs: transformed.refs,
      note: combineNotes(prepared.note, transformed.note),
    };
  }
}

export class BrowserNavigateTool extends BaseBrowserUseTool {
  readonly name = 'browser_navigate';
  readonly description = BROWSER_NAVIGATE_DESCRIPTION;
  readonly schema = navigateSchema;

  protected prepareExecution(args: Record<string, unknown>): PreparedBrowserInvocation {
    const request = args as z.infer<typeof navigateSchema>;
    return {
      commands: [['open', request.url]],
      invalidateCachedRefs: true,
      note: request.new_tab
        ? 'new_tab is ignored by the local agent-browser path and uses the current session.'
        : undefined,
    };
  }
}

export class BrowserClickTool extends BaseBrowserUseTool {
  readonly name = 'browser_click';
  readonly description = BROWSER_CLICK_DESCRIPTION;
  readonly schema = clickSchema;

  protected prepareExecution(
    args: Record<string, unknown>,
    context: ToolContext,
  ): PreparedBrowserInvocation {
    const request = args as z.infer<typeof clickSchema>;
    return {
      commands: [['click', resolveRefForIndex(request.index, context)]],
      note: request.new_tab
        ? 'new_tab is ignored by the local agent-browser path and uses the current session.'
        : undefined,
    };
  }
}

export class BrowserTypeTool extends BaseBrowserUseTool {
  readonly name = 'browser_type';
  readonly description = BROWSER_TYPE_DESCRIPTION;
  readonly schema = typeSchema;

  protected prepareExecution(
    args: Record<string, unknown>,
    context: ToolContext,
  ): PreparedBrowserInvocation {
    const request = args as z.infer<typeof typeSchema>;
    return {
      commands: [['fill', resolveRefForIndex(request.index, context), request.text]],
    };
  }
}

export class BrowserGetStateTool extends BaseBrowserUseTool {
  readonly name = 'browser_get_state';
  readonly description = BROWSER_GET_STATE_DESCRIPTION;
  readonly schema = getStateSchema;

  protected prepareExecution(args: Record<string, unknown>): PreparedBrowserInvocation {
    const request = args as z.infer<typeof getStateSchema>;
    return {
      commands: request.include_screenshot
        ? [['snapshot', '-i'], ['screenshot']]
        : [['snapshot', '-i']],
      transform: (results, context) => {
        const refs = parseSnapshotRefs(results[0]?.stdout ?? '');
        snapshotRefsByWorkspace.set(context.workspace as object, refs);
        return {
          output: results
            .map((result) => result.output)
            .filter(Boolean)
            .join('\n\n'),
          refs,
          note:
            refs.length === 0
              ? 'No interactive refs were found in the latest snapshot.'
              : undefined,
        };
      },
    };
  }
}

export class BrowserGetContentTool extends BaseBrowserUseTool {
  readonly name = 'browser_get_content';
  readonly description = BROWSER_GET_CONTENT_DESCRIPTION;
  readonly schema = getContentSchema;

  protected prepareExecution(args: Record<string, unknown>): PreparedBrowserInvocation {
    const request = args as z.infer<typeof getContentSchema>;
    return {
      commands: [['snapshot', '-c']],
      transform: (results) => ({
        output: (results[0]?.stdout ?? '').slice(request.start_from_char),
        note: request.extract_links
          ? 'extract_links is accepted for compatibility but agent-browser snapshot output is returned as-is.'
          : undefined,
      }),
    };
  }
}

export class BrowserScrollTool extends BaseBrowserUseTool {
  readonly name = 'browser_scroll';
  readonly description = BROWSER_SCROLL_DESCRIPTION;
  readonly schema = scrollSchema;

  protected prepareExecution(args: Record<string, unknown>): PreparedBrowserInvocation {
    const request = args as z.infer<typeof scrollSchema>;
    return {
      commands: [['scroll', request.direction, DEFAULT_SCROLL_DISTANCE]],
    };
  }
}

export class BrowserGoBackTool extends BaseBrowserUseTool {
  readonly name = 'browser_go_back';
  readonly description = BROWSER_GO_BACK_DESCRIPTION;
  readonly schema = goBackSchema;

  protected prepareExecution(): PreparedBrowserInvocation {
    return {
      commands: [['back']],
      invalidateCachedRefs: true,
    };
  }
}

export class BrowserListTabsTool extends BaseBrowserUseTool {
  readonly name = 'browser_list_tabs';
  readonly description = BROWSER_LIST_TABS_DESCRIPTION;
  readonly schema = listTabsSchema;

  protected prepareExecution(): PreparedBrowserInvocation {
    return {
      commands: [['get', 'title'], ['get', 'url']],
      transform: (results) => ({
        output: JSON.stringify(
          [
            {
              tab_id: 'current',
              title: results[0]?.stdout ?? '',
              url: results[1]?.stdout ?? '',
            },
          ],
          null,
          2,
        ),
        note: 'Local agent-browser currently exposes a single active browser session.',
      }),
    };
  }
}

export class BrowserSwitchTabTool extends BaseBrowserUseTool {
  readonly name = 'browser_switch_tab';
  readonly description = BROWSER_SWITCH_TAB_DESCRIPTION;
  readonly schema = switchTabSchema;

  protected prepareExecution(): PreparedBrowserInvocation {
    throw new Error('browser_switch_tab is not supported by the local agent-browser path yet.');
  }
}

export class BrowserCloseTabTool extends BaseBrowserUseTool {
  readonly name = 'browser_close_tab';
  readonly description = BROWSER_CLOSE_TAB_DESCRIPTION;
  readonly schema = closeTabSchema;

  protected prepareExecution(): PreparedBrowserInvocation {
    throw new Error('browser_close_tab is not supported by the local agent-browser path yet.');
  }
}

export const browserUseTools = [
  BrowserNavigateTool,
  BrowserClickTool,
  BrowserGetStateTool,
  BrowserGetContentTool,
  BrowserTypeTool,
  BrowserScrollTool,
  BrowserGoBackTool,
  BrowserListTabsTool,
  BrowserSwitchTabTool,
  BrowserCloseTabTool,
];
