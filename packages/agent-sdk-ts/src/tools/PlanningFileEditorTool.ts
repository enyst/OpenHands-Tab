import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { FileEditorTool, type FileEditorResult } from './FileEditorTool';
import { ZodTool } from './zod-tool';

export type PlanningCommand = FileEditorResult['command'];
export type PlanningFileEditorResult = FileEditorResult;

const FILE_EDITOR_TOOL_DESCRIPTION = new FileEditorTool().description;
const planningSchema = new FileEditorTool().schema;

const PLAN_BASENAME = 'PLAN.md';

const PLAN_HEADERS = [
  '# 1. OBJECTIVE\n',
  '# 2. CONTEXT SUMMARY\n',
  '# 3. APPROACH OVERVIEW\n',
  '# 4. IMPLEMENTATION STEPS\n',
  '# 5. TESTING AND VALIDATION\n',
].join('\n');

const TOOL_DESCRIPTION = `${FILE_EDITOR_TOOL_DESCRIPTION}

IMPORTANT RESTRICTION FOR PLANNING AGENT:
* You can VIEW any file in the workspace using the 'view' command
* You can ONLY EDIT the PLAN.md file (all other edit operations will be rejected)
* If PLAN.md does not exist, it may be initialized with standard section headers
* All editing commands (create, str_replace, insert, undo_edit) are restricted to PLAN.md only
* The PLAN.md file should follow the required section structure - fill in the content`;

export class PlanningFileEditorTool extends ZodTool<z.infer<typeof planningSchema>, PlanningFileEditorResult> {
  readonly name = 'planning_file_editor';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = planningSchema;
  private readonly fileEditor = new FileEditorTool();

  private ensurePlanTarget(command: PlanningCommand, resolvedPath: string): void {
    if (command === 'view') return;
    if (path.basename(resolvedPath) !== PLAN_BASENAME) {
      throw new Error('Only PLAN.md may be modified by this tool');
    }
  }

  private async ensurePlanInitialized(planPath: string, context: ToolContext): Promise<void> {
    try {
      await fs.stat(planPath);
      return;
    } catch (error) {
      if (typeof error !== 'object' || !error || !('code' in error) || (error as { code?: unknown }).code !== 'ENOENT') {
        throw error;
      }
    }

    await context.workspace.writeFile(planPath, PLAN_HEADERS);
  }

  async execute(args: z.infer<typeof planningSchema>, context: ToolContext): Promise<PlanningFileEditorResult> {
    const resolved = context.workspace.resolvePath(args.path);
    this.ensurePlanTarget(args.command, resolved);
    if (args.command === 'view' && path.basename(resolved) === PLAN_BASENAME) {
      await this.ensurePlanInitialized(resolved, context);
    }
    return this.fileEditor.execute(args, context);
  }
}
