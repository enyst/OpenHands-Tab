import type { ToolDefinition } from '@openhands/agent-sdk-ts';
import { FileEditorTool, TaskTrackerTool, TerminalTool } from '@openhands/agent-sdk-ts';

export type LocalToolId = 'terminal' | 'file_editor' | 'task_tracker';

export type LocalToolDescriptor = {
  id: LocalToolId;
  label: string;
};

const LOCAL_TOOLS: LocalToolDescriptor[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'file_editor', label: 'File Editor' },
  { id: 'task_tracker', label: 'Task Tracker' },
];

type LocalToolInstances = Record<LocalToolId, ToolDefinition<unknown, unknown>>;

let instances: LocalToolInstances | null = null;

export function listLocalToolDescriptors(): LocalToolDescriptor[] {
  return [...LOCAL_TOOLS];
}

export function getDefaultLocalToolIds(): LocalToolId[] {
  return LOCAL_TOOLS.map((tool) => tool.id);
}

export function normalizeLocalToolIds(value: unknown): LocalToolId[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return null;

  const out: LocalToolId[] = [];
  const seen = new Set<LocalToolId>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim() as LocalToolId;
    if (id !== 'terminal' && id !== 'file_editor' && id !== 'task_tracker') continue;
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
  };
  return instances;
}

export function resolveLocalTools(toolIds?: LocalToolId[] | null): ToolDefinition<unknown, unknown>[] {
  const resolved: ToolDefinition<unknown, unknown>[] = [];
  const byId = getOrCreateLocalToolInstances();
  const ids = toolIds === undefined || toolIds === null ? getDefaultLocalToolIds() : toolIds;

  for (const id of ids) {
    if (id === 'terminal' || id === 'file_editor' || id === 'task_tracker') {
      resolved.push(byId[id]);
    }
  }
  return resolved;
}
