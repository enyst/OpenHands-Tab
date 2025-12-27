import type { ToolDefinition } from '@openhands/agent-sdk-ts';
import {
  BrowserTool,
  FileEditorTool,
  FinishTool,
  GlobTool,
  GrepTool,
  TaskTrackerTool,
  TerminalTool,
} from '@openhands/agent-sdk-ts';

export type LocalToolId =
  | 'terminal'
  | 'file_editor'
  | 'task_tracker'
  | 'glob'
  | 'grep'
  | 'browser'
  | 'finish';

export type LocalToolDescriptor = {
  id: LocalToolId;
  label: string;
  description: string;
  isDefault: boolean;
};

const LOCAL_TOOLS: LocalToolDescriptor[] = [
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Execute shell commands in a controlled environment',
    isDefault: true,
  },
  {
    id: 'file_editor',
    label: 'File Editor',
    description: 'Read, create, and modify files in the workspace',
    isDefault: true,
  },
  {
    id: 'task_tracker',
    label: 'Task Tracker',
    description: 'Track tasks and progress during the conversation',
    isDefault: true,
  },
  {
    id: 'glob',
    label: 'File Search (Glob)',
    description: 'Find files by name patterns (e.g., **/*.ts)',
    isDefault: false,
  },
  {
    id: 'grep',
    label: 'Content Search (Grep)',
    description: 'Search file contents using regex patterns',
    isDefault: false,
  },
  {
    id: 'browser',
    label: 'Web Fetch',
    description: 'Make HTTP GET/POST requests to fetch web content',
    isDefault: false,
  },
  {
    id: 'finish',
    label: 'Finish',
    description: 'Signal that the agent has completed its task',
    isDefault: false,
  },
];

type LocalToolInstances = Record<LocalToolId, ToolDefinition<unknown, unknown>>;

let instances: LocalToolInstances | null = null;

export function listLocalToolDescriptors(): LocalToolDescriptor[] {
  return [...LOCAL_TOOLS];
}

export function getDefaultLocalToolIds(): LocalToolId[] {
  return LOCAL_TOOLS.filter((tool) => tool.isDefault).map((tool) => tool.id);
}

const VALID_TOOL_IDS = new Set<LocalToolId>(LOCAL_TOOLS.map((tool) => tool.id));

export function isValidLocalToolId(id: string): id is LocalToolId {
  return VALID_TOOL_IDS.has(id as LocalToolId);
}

export function normalizeLocalToolIds(value: unknown): LocalToolId[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;

  const out: LocalToolId[] = [];
  const seen = new Set<LocalToolId>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!isValidLocalToolId(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function getOrCreateLocalToolInstances(): LocalToolInstances {
  if (instances) return instances;
  instances = {
    terminal: new TerminalTool(),
    file_editor: new FileEditorTool(),
    task_tracker: new TaskTrackerTool(),
    glob: new GlobTool(),
    grep: new GrepTool(),
    browser: new BrowserTool(),
    finish: new FinishTool(),
  };
  return instances;
}

export function resolveLocalTools(toolIds?: LocalToolId[] | null): ToolDefinition<unknown, unknown>[] {
  const resolved: ToolDefinition<unknown, unknown>[] = [];
  const byId = getOrCreateLocalToolInstances();
  const ids = toolIds === undefined || toolIds === null ? getDefaultLocalToolIds() : toolIds;

  for (const id of ids) {
    if (isValidLocalToolId(id)) {
      resolved.push(byId[id]);
    }
  }
  return resolved;
}
