import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

export interface TaskItem {
  title: string;
  notes?: string;
  status: 'todo' | 'in_progress' | 'done';
}

export interface TaskTrackerResult {
  command: 'view' | 'plan';
  task_list: TaskItem[];
}

const TASK_TRACKER_DESCRIPTION = `Manage a structured task list for the current workspace.

Use this tool to create or update a lightweight plan when work has multiple steps.

Commands:
- plan: overwrite TASKS.json with the provided task_list
- view: read TASKS.json and return the current task_list

Task items:
- title (required)
- notes (optional)
- status: todo | in_progress | done (prefer at most one in_progress at a time)`;

const taskItemSchema = z.object({
  title: z.string().describe('A brief title for the task.'),
  notes: z.string().optional().default('').describe('Additional details or notes about the task.'),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo').describe("The current status of the task. One of 'todo', 'in_progress', or 'done'."),
});

const trackerSchema = z
  .object({
    command: z
      .enum(['view', 'plan'])
      .default('view')
      .describe('The command to execute. `view` shows the current task list. `plan` creates or updates the task list based on provided requirements and progress. Always `view` the current list before making changes.'),
    task_list: z
      .array(taskItemSchema)
      .default([])
      .describe('The full task list. Required parameter of `plan` command.'),
  })
  .strict();

export class TaskTrackerTool extends ZodTool<z.infer<typeof trackerSchema>, TaskTrackerResult> {
  readonly name = 'task_tracker';
  readonly description = TASK_TRACKER_DESCRIPTION;
  readonly schema = trackerSchema;

  private async loadTasks(savePath: string): Promise<TaskItem[]> {
    try {
      const raw = await fs.readFile(savePath, 'utf8');
      const json = JSON.parse(raw) as unknown;
      const parsed = z.array(taskItemSchema).safeParse(json);
      if (parsed.success) {
        return parsed.data;
      }
      console.warn(`[TaskTrackerTool] Failed to parse TASKS.json: ${parsed.error.message}`);
      return [];
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveTasks(savePath: string, tasks: TaskItem[]): Promise<void> {
    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, JSON.stringify(tasks, null, 2), 'utf8');
  }

  async execute(args: z.infer<typeof trackerSchema>, context: ToolContext): Promise<TaskTrackerResult> {
    const root = context.workspace.root;
    const savePath = path.join(root, '.openhands', 'TASKS.json');

    if (args.command === 'plan') {
      const tasks = args.task_list ?? [];
      await this.saveTasks(savePath, tasks);
      return { command: 'plan', task_list: tasks };
    }

    // view
    const tasks = await this.loadTasks(savePath);
    if (!tasks.length) {
      return { command: 'view', task_list: [] };
    }
    return { command: 'view', task_list: tasks };
  }
}
