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

## Usage Scenarios

**Scenario A: Feature Development with Validation**
User request: "Build a user authentication system with login/logout functionality.
Don't forget to include input validation and error handling!"

Response approach: I'll implement a user authentication system with comprehensive
validation. Let me organize this work systematically.

*Task breakdown includes:*
1. Design authentication API endpoints and data models
2. Implement user login/logout controllers with session management
3. Add client-side form validation and error display
4. Create backend input sanitization and security checks
5. Implement comprehensive error handling for edge cases
6. Perform integration testing and fix any issues

**Scenario B: Codebase Refactoring**
User request: "I need to update all instances of the method 'fetchData' to
'retrieveInformation' throughout the entire project"

Response approach: Let me first analyze your codebase to identify all locations
where 'fetchData' appears.

*After code analysis*

I've located 12 occurrences of 'fetchData' across 6 files in your project.
I'll create a systematic plan to update these references.

*Organized task list includes specific file-by-file updates*

**Scenario C: Multi-feature Development**
User request: "Set up a blog platform with these components: admin dashboard,
article management, comment system, and user profiles."

Response approach: I'll help build your blog platform. Let me break down these
components into manageable implementation phases.

*Creates structured plan with each feature decomposed into specific development tasks*

## Counter-examples - Direct Implementation Preferred

**Counter-example A: Simple inquiry**
User request: "What's the syntax for a for loop in JavaScript?"

Response approach: Here's how to write a for loop in JavaScript:

\`\`\`javascript
for (let i = 0; i < array.length; i++) {
    console.log(array[i]);
}
\`\`\`

*No task tracking needed - single informational response*

**Counter-example B: Minor modification**
User request: "Please add a docstring to the processPayment function explaining
its parameters."

Response approach: I'll add a docstring to explain the processPayment function.

*Direct edit without task tracking for simple modification*

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
