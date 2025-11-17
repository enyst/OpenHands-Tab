import { randomUUID } from 'crypto';
import type { ToolContext, ToolHandler } from './types';
import { requireBoolean, requireObject, requireString, optionalString } from './validation';

interface TaskRecord {
  id: string;
  title: string;
  completed: boolean;
  notes?: string;
}

export interface TaskTrackerArgs {
  action: 'create' | 'complete' | 'list' | 'update';
  id?: string;
  title?: string;
  notes?: string;
  completed?: boolean;
}

export interface TaskTrackerResult {
  tasks: TaskRecord[];
}

export class TaskTrackerTool implements ToolHandler<TaskTrackerArgs, TaskTrackerResult> {
  readonly name = 'task_tracker';
  private readonly tasks: Map<string, TaskRecord> = new Map();

  validate(input: unknown): TaskTrackerArgs {
    const obj = requireObject(input, 'task tracker args');
    const action = requireString(obj.action, 'action');
    if (!['create', 'complete', 'list', 'update'].includes(action)) {
      throw new Error('Unsupported task tracker action');
    }

    const id = optionalString(obj.id, 'id');
    const title = optionalString(obj.title, 'title');
    const notes = optionalString(obj.notes, 'notes');
    const completed = obj.completed === undefined ? undefined : requireBoolean(obj.completed, 'completed');
    return { action: action as TaskTrackerArgs['action'], id, title, notes, completed };
  }

  async execute(args: TaskTrackerArgs, _context: ToolContext): Promise<TaskTrackerResult> {
    switch (args.action) {
      case 'create':
        this.createTask(args.title ?? 'Untitled task', args.notes);
        break;
      case 'complete':
        if (!args.id) throw new Error('id is required to complete a task');
        this.updateTask(args.id, { completed: true });
        break;
      case 'update':
        if (!args.id) throw new Error('id is required to update a task');
        this.updateTask(args.id, {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          ...(args.completed !== undefined ? { completed: args.completed } : {}),
        });
        break;
      case 'list':
      default:
        break;
    }

    return { tasks: Array.from(this.tasks.values()) };
  }

  private createTask(title: string, notes?: string): TaskRecord {
    const task: TaskRecord = { id: randomUUID(), title, completed: false, notes };
    this.tasks.set(task.id, task);
    return task;
  }

  private updateTask(id: string, updates: Partial<TaskRecord>): void {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error('Task not found');
    }
    const updated: TaskRecord = { ...existing, ...updates };
    this.tasks.set(id, updated);
  }
}
