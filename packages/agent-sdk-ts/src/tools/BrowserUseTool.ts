import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool, booleanWithDefault } from './zod-tool';

export interface BrowserUseResult {
  action: string;
  request: Record<string, unknown>;
  note: string;
}

const stubExecution = (name: string, args: Record<string, unknown>): BrowserUseResult => ({
  action: name,
  request: args,
  note: 'Stubbed browser_use action executed',
});

const navigateSchema = z.object({
  url: z.string().url(),
  new_tab: booleanWithDefault(false),
});

const clickSchema = z.object({
  index: z.number().int().min(0),
  new_tab: booleanWithDefault(false),
});

const typeSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
});

const getStateSchema = z.object({
  include_screenshot: booleanWithDefault(false),
});

const getContentSchema = z.object({
  extract_links: booleanWithDefault(false),
  start_from_char: z.number().int().min(0).default(0),
});

const scrollSchema = z.object({
  direction: z.union([z.literal('up'), z.literal('down')]).default('down'),
});

const goBackSchema = z.object({});
const listTabsSchema = z.object({});

const switchTabSchema = z.object({
  tab_id: z.string(),
});

const closeTabSchema = z.object({
  tab_id: z.string(),
});

const BROWSER_NAVIGATE_DESCRIPTION = `Navigate to a URL in the browser.

This tool allows you to navigate to any web page. You can optionally open the URL in a new tab.

Parameters:
- url: The URL to navigate to (required)
- new_tab: Whether to open in a new tab (optional, default: False)

Examples:
- Navigate to Google: url="https://www.google.com"
- Open GitHub in new tab: url="https://github.com", new_tab=True`;

const BROWSER_CLICK_DESCRIPTION = `Click an element on the page by its index.

Use this tool to click on interactive elements like buttons, links, or form controls.
The index comes from the browser_get_state tool output.

Parameters:
- index: The index of the element to click (from browser_get_state)
- new_tab: Whether to open any resulting navigation in a new tab (optional)

Important: Only use indices that appear in your current browser_get_state output.`;

const BROWSER_TYPE_DESCRIPTION = `Type text into an input field.

Use this tool to enter text into form fields, search boxes, or other text input elements.
The index comes from the browser_get_state tool output.

Parameters:
- index: The index of the input element (from browser_get_state)
- text: The text to type

Important: Only use indices that appear in your current browser_get_state output.`;

const BROWSER_GET_STATE_DESCRIPTION = `Get the current state of the page including all interactive elements.

This tool returns the current page content with numbered interactive elements that you can
click or type into. Use this frequently to understand what's available on the page.

Parameters:
- include_screenshot: Whether to include a screenshot (optional, default: False)`;

const BROWSER_GET_CONTENT_DESCRIPTION = `Extract the main content of the current page in clean markdown format. It has been filtered to remove noise and advertising content.

If the content was truncated and you need more information, use start_from_char parameter to continue from where truncation occurred.`;

const BROWSER_SCROLL_DESCRIPTION = `Scroll the page up or down.

Use this tool to scroll through page content when elements are not visible or when you need
to see more content.

Parameters:
- direction: Direction to scroll - "up" or "down" (optional, default: "down")`;

const BROWSER_GO_BACK_DESCRIPTION = `Go back to the previous page in browser history.

Use this tool to navigate back to the previously visited page, similar to clicking the browser's back button.`;

const BROWSER_LIST_TABS_DESCRIPTION = `List all open browser tabs.

This tool shows all currently open tabs with their IDs, titles, and URLs. Use the tab IDs
with browser_switch_tab or browser_close_tab.`;

const BROWSER_SWITCH_TAB_DESCRIPTION = `Switch to a different browser tab.

Use this tool to switch between open tabs. Get the tab_id from browser_list_tabs.

Parameters:
- tab_id: 4 Character Tab ID of the tab to switch to`;

const BROWSER_CLOSE_TAB_DESCRIPTION = `Close a specific browser tab.

Use this tool to close tabs you no longer need. Get the tab_id from browser_list_tabs.

Parameters:
- tab_id: 4 Character Tab ID of the tab to close`;

const navParams = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The URL to navigate to' },
    new_tab: {
      type: 'boolean',
      description: 'Whether to open in a new tab. Default: False',
    },
  },
  required: ['url'],
};

const clickParams = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      description: 'The index of the element to click (from browser_get_state)',
      minimum: 0,
    },
    new_tab: {
      type: 'boolean',
      description: 'Whether to open any resulting navigation in a new tab. Default: False',
    },
  },
  required: ['index'],
};

const typeParams = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      description: 'The index of the input element (from browser_get_state)',
      minimum: 0,
    },
    text: { type: 'string', description: 'The text to type' },
  },
  required: ['index', 'text'],
};

const getStateParams = {
  type: 'object',
  properties: {
    include_screenshot: {
      type: 'boolean',
      description: 'Whether to include a screenshot of the current page. Default: False',
    },
  },
};

const getContentParams = {
  type: 'object',
  properties: {
    extract_links: {
      type: 'boolean',
      description: 'Whether to include links in the content (default: False)',
    },
    start_from_char: {
      type: 'integer',
      description: 'Character index to start from in the page content (default: 0)',
      minimum: 0,
    },
  },
};

const scrollParams = {
  type: 'object',
  properties: {
    direction: {
      type: 'string',
      enum: ['up', 'down'],
      description: "Direction to scroll. Options: 'up', 'down'. Default: 'down'",
    },
  },
};

const tabParamShape = {
  type: 'object',
  properties: {
    tab_id: { type: 'string', description: '4 Character Tab ID of the tab' },
  },
  required: ['tab_id'],
};

abstract class BaseBrowserUseTool extends ZodTool<Record<string, unknown>, BrowserUseResult> {
  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<BrowserUseResult> {
    return Promise.resolve(stubExecution(this.name, args));
  }
}

export class BrowserNavigateTool extends BaseBrowserUseTool {
  readonly name = 'browser_navigate';
  readonly description = BROWSER_NAVIGATE_DESCRIPTION;
  readonly schema = navigateSchema;
  readonly parameters = navParams;
}

export class BrowserClickTool extends BaseBrowserUseTool {
  readonly name = 'browser_click';
  readonly description = BROWSER_CLICK_DESCRIPTION;
  readonly schema = clickSchema;
  readonly parameters = clickParams;
}

export class BrowserTypeTool extends BaseBrowserUseTool {
  readonly name = 'browser_type';
  readonly description = BROWSER_TYPE_DESCRIPTION;
  readonly schema = typeSchema;
  readonly parameters = typeParams;
}

export class BrowserGetStateTool extends BaseBrowserUseTool {
  readonly name = 'browser_get_state';
  readonly description = BROWSER_GET_STATE_DESCRIPTION;
  readonly schema = getStateSchema;
  readonly parameters = getStateParams;
}

export class BrowserGetContentTool extends BaseBrowserUseTool {
  readonly name = 'browser_get_content';
  readonly description = BROWSER_GET_CONTENT_DESCRIPTION;
  readonly schema = getContentSchema;
  readonly parameters = getContentParams;
}

export class BrowserScrollTool extends BaseBrowserUseTool {
  readonly name = 'browser_scroll';
  readonly description = BROWSER_SCROLL_DESCRIPTION;
  readonly schema = scrollSchema;
  readonly parameters = scrollParams;
}

export class BrowserGoBackTool extends BaseBrowserUseTool {
  readonly name = 'browser_go_back';
  readonly description = BROWSER_GO_BACK_DESCRIPTION;
  readonly schema = goBackSchema;
  readonly parameters = { type: 'object', properties: {} };
}

export class BrowserListTabsTool extends BaseBrowserUseTool {
  readonly name = 'browser_list_tabs';
  readonly description = BROWSER_LIST_TABS_DESCRIPTION;
  readonly schema = listTabsSchema;
  readonly parameters = { type: 'object', properties: {} };
}

export class BrowserSwitchTabTool extends BaseBrowserUseTool {
  readonly name = 'browser_switch_tab';
  readonly description = BROWSER_SWITCH_TAB_DESCRIPTION;
  readonly schema = switchTabSchema;
  readonly parameters = tabParamShape;
}

export class BrowserCloseTabTool extends BaseBrowserUseTool {
  readonly name = 'browser_close_tab';
  readonly description = BROWSER_CLOSE_TAB_DESCRIPTION;
  readonly schema = closeTabSchema;
  readonly parameters = tabParamShape;
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

