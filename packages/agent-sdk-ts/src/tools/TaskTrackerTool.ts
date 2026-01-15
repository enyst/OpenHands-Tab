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

const TASK_TRACKER_DESCRIPTION = `This tool provides structured task management capabilities for development workflows.
It enables systematic tracking of work items, progress monitoring, and efficient
organization of complex development activities.

The tool maintains visibility into project status and helps communicate
progress effectively to users.

## Commands

- plan: overwrite TASKS.json with the provided task_list
- view: read TASKS.json and return the current task_list (always view before making changes)

## Task items

- title (required): A brief title for the task
- notes (optional): Additional details or notes about the task
- status: todo | in_progress | done (prefer at most one in_progress at a time)

## Application Guidelines

Utilize this tool in the following situations:

1. Multi-phase development work - When projects involve multiple sequential or
   parallel activities
2. Complex implementation tasks - Work requiring systematic planning and
   coordination across multiple components
3. Explicit user request for task organization - When users specifically ask
   for structured task management
4. Multiple concurrent requirements - When users present several work items
   that need coordination
5. Project initiation - Capture and organize user requirements at project start
6. Work commencement - Update task status to in_progress before beginning
   implementation. Maintain focus by limiting active work to one task
7. Task completion - Update status to done and identify any additional work
   that emerged during implementation

## Situations Where Tool Usage Is Unnecessary

Avoid using this tool when:

1. Single atomic tasks that require no decomposition
2. Trivial operations where tracking adds no organizational value
3. Simple activities completable in minimal steps
4. Pure information exchange or discussion

Note: For single straightforward tasks, proceed with direct implementation
rather than creating tracking overhead.

## Status Management and Workflow

1. **Status Values**: Track work using these states:
   - todo: Not yet initiated
   - in_progress: Currently active (maintain single focus)
   - done: Successfully completed

2. **Workflow Practices**:
   - Update status dynamically as work progresses
   - Mark completion immediately upon task finish
   - Limit active work to ONE task at any given time
   - Complete current activities before initiating new ones
   - Remove obsolete tasks from tracking entirely

3. **Completion Criteria**:
   - Mark tasks as done only when fully achieved
   - Keep status as in_progress if errors, blocks, or partial completion exist
   - Create new tasks for discovered issues or dependencies
   - Never mark done when:
       - Test suites are failing
       - Implementation remains incomplete
       - Unresolved errors persist
       - Required resources are unavailable

4. **Task Organization**:
   - Write precise, actionable descriptions
   - Decompose complex work into manageable units
   - Use descriptive, clear naming conventions

When uncertain, favor using this tool. Proactive task management demonstrates
systematic approach and ensures comprehensive requirement fulfillment.`;

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
