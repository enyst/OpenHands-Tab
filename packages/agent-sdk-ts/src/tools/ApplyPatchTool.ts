import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';

type ActionType = 'add' | 'delete' | 'update';

type FileChange = {
  type: ActionType;
  old_content?: string | null;
  new_content?: string | null;
  move_path?: string | null;
};

export type ApplyPatchCommit = {
  changes: Record<string, FileChange>;
};

type Chunk = {
  orig_index: number;
  del_lines: string[];
  ins_lines: string[];
};

type PatchAction = {
  type: ActionType;
  new_file?: string | null;
  chunks?: Chunk[];
  move_path?: string | null;
};

type Patch = {
  actions: Record<string, PatchAction>;
};

class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffError';
  }
}

const applyPatchSchema = z.object({
  patch: z.string().describe("Patch text starting with '*** Begin Patch' and ending with '*** End Patch'."),
});

export type ApplyPatchArgs = z.infer<typeof applyPatchSchema>;

export type ApplyPatchResult = {
  message: string;
  fuzz: number;
  commit: ApplyPatchCommit;
};

const TOOL_DESCRIPTION =
  "Apply unified text patches to files in the workspace. Input must start with '*** Begin Patch' and end with '*** End Patch'.";

type ParserState = {
  current_files: Record<string, string>;
  lines: string[];
  index: number;
  patch: Patch;
  fuzz: number;
};

const isDone = (state: ParserState, prefixes?: string[]): boolean => {
  if (state.index >= state.lines.length) return true;
  if (prefixes && prefixes.some((p) => state.lines[state.index].startsWith(p))) return true;
  return false;
};

const startswith = (state: ParserState, prefix: string | string[]): boolean => {
  if (state.index >= state.lines.length) {
    throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
  }
  const line = state.lines[state.index];
  if (Array.isArray(prefix)) return prefix.some((p) => line.startsWith(p));
  return line.startsWith(prefix);
};

const readStr = (state: ParserState, prefix = '', returnEverything = false): string => {
  if (state.index >= state.lines.length) {
    throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
  }
  const line = state.lines[state.index];
  if (!line.startsWith(prefix)) return '';
  const text = returnEverything ? line : line.slice(prefix.length);
  state.index += 1;
  return text;
};

const parseAddFile = (state: ParserState): PatchAction => {
  const lines: string[] = [];
  while (!isDone(state, ['*** End Patch', '*** Update File:', '*** Delete File:', '*** Add File:'])) {
    const s = readStr(state);
    if (!s.startsWith('+')) {
      throw new DiffError(`Invalid Add File Line: ${s}`);
    }
    lines.push(s.slice(1));
  }
  return { type: 'add', new_file: lines.join('\n') };
};

const findContextCore = (lines: string[], context: string[], start: number): { index: number; fuzz: number } => {
  if (context.length === 0) return { index: start, fuzz: 0 };

  for (let i = start; i < lines.length; i++) {
    const slice = lines.slice(i, i + context.length);
    if (slice.length === context.length && slice.every((s, j) => s === context[j])) {
      return { index: i, fuzz: 0 };
    }
  }

  for (let i = start; i < lines.length; i++) {
    const slice = lines.slice(i, i + context.length);
    if (
      slice.length === context.length
      && slice.map((s) => s.replace(/\r?\n$/, '').trimEnd()).every((s, j) => s === context[j].trimEnd())
    ) {
      return { index: i, fuzz: 1 };
    }
  }

  for (let i = start; i < lines.length; i++) {
    const slice = lines.slice(i, i + context.length);
    if (
      slice.length === context.length
      && slice.map((s) => s.trim()).every((s, j) => s === context[j].trim())
    ) {
      return { index: i, fuzz: 100 };
    }
  }

  return { index: -1, fuzz: 0 };
};

const findContext = (lines: string[], context: string[], start: number, eof: boolean): { index: number; fuzz: number } => {
  if (!eof) return findContextCore(lines, context, start);

  const tailStart = Math.max(0, lines.length - context.length);
  const atTail = findContextCore(lines, context, tailStart);
  if (atTail.index !== -1) return atTail;

  const anywhere = findContextCore(lines, context, start);
  if (anywhere.index === -1) return anywhere;
  return { index: anywhere.index, fuzz: anywhere.fuzz + 10_000 };
};

const peekNextSection = (lines: string[], index: number): { old: string[]; chunks: Chunk[]; endIndex: number; eof: boolean } => {
  const old: string[] = [];
  let delLines: string[] = [];
  let insLines: string[] = [];
  const chunks: Chunk[] = [];
  let mode: 'keep' | 'add' | 'delete' = 'keep';
  const origIndex = index;

  while (index < lines.length) {
    let s = lines[index];
    if (
      s.startsWith('@@')
      || s.startsWith('*** End Patch')
      || s.startsWith('*** Update File:')
      || s.startsWith('*** Delete File:')
      || s.startsWith('*** Add File:')
      || s.startsWith('*** End of File')
    ) {
      break;
    }
    if (s === '***') break;
    if (s.startsWith('***')) throw new DiffError(`Invalid Line: ${s}`);

    index += 1;

    const lastMode = mode;
    if (s === '') s = ' ';
    const sigil = s[0];
    if (sigil === '+') mode = 'add';
    else if (sigil === '-') mode = 'delete';
    else if (sigil === ' ') mode = 'keep';
    else throw new DiffError(`Invalid Line: ${s}`);

    const line = s.slice(1);

    if (mode === 'keep' && lastMode !== mode) {
      if (insLines.length || delLines.length) {
        chunks.push({
          orig_index: old.length - delLines.length,
          del_lines: delLines,
          ins_lines: insLines,
        });
      }
      delLines = [];
      insLines = [];
    }

    if (mode === 'delete') {
      delLines.push(line);
      old.push(line);
    } else if (mode === 'add') {
      insLines.push(line);
    } else {
      old.push(line);
    }
  }

  if (insLines.length || delLines.length) {
    chunks.push({
      orig_index: old.length - delLines.length,
      del_lines: delLines,
      ins_lines: insLines,
    });
  }

  if (index < lines.length && lines[index] === '*** End of File') {
    return { old, chunks, endIndex: index + 1, eof: true };
  }
  if (index === origIndex) {
    throw new DiffError(`Nothing in this section - index=${index} ${lines[index]}`);
  }
  return { old, chunks, endIndex: index, eof: false };
};

const parseUpdateFile = (state: ParserState, text: string): PatchAction => {
  const action: PatchAction = { type: 'update', chunks: [] };
  const fileLines = text.split('\n');
  let index = 0;

  while (!isDone(state, ['*** End Patch', '*** Update File:', '*** Delete File:', '*** Add File:', '*** End of File'])) {
    const defStr = readStr(state, '@@ ');
    let sectionStr = '';
    if (!defStr && state.lines[state.index] === '@@') {
      sectionStr = state.lines[state.index];
      state.index += 1;
    }
    if (!(defStr || sectionStr || index === 0)) {
      throw new DiffError(`Invalid Line:\n${state.lines[state.index]}`);
    }

    if (defStr.trim()) {
      let found = false;

      if (!fileLines.slice(0, index).some((s) => s === defStr)) {
        for (let i = index; i < fileLines.length; i++) {
          if (fileLines[i] === defStr) {
            index = i + 1;
            found = true;
            break;
          }
        }
      }

      if (!found && !fileLines.slice(0, index).some((s) => s.trim() === defStr.trim())) {
        for (let i = index; i < fileLines.length; i++) {
          if (fileLines[i].trim() === defStr.trim()) {
            index = i + 1;
            state.fuzz += 1;
            found = true;
            break;
          }
        }
      }
    }

    const { old: nextChunkContext, chunks, endIndex, eof } = peekNextSection(state.lines, state.index);
    const nextChunkText = nextChunkContext.join('\n');

    const { index: newIndex, fuzz } = findContext(fileLines, nextChunkContext, index, eof);
    if (newIndex === -1) {
      if (eof) throw new DiffError(`Invalid EOF Context ${index}:\n${nextChunkText}`);
      throw new DiffError(`Invalid Context ${index}:\n${nextChunkText}`);
    }

    state.fuzz += fuzz;
    for (const ch of chunks) {
      action.chunks?.push({
        orig_index: ch.orig_index + newIndex,
        del_lines: ch.del_lines,
        ins_lines: ch.ins_lines,
      });
    }

    index = newIndex + nextChunkContext.length;
    state.index = endIndex;
  }

  return action;
};

const parsePatchText = (text: string, orig: Record<string, string>): { patch: Patch; fuzz: number } => {
  const lines = text.trim().split('\n');
  if (lines.length < 2 || !lines[0].startsWith('*** Begin Patch') || lines[lines.length - 1] !== '*** End Patch') {
    throw new DiffError('Invalid patch text');
  }

  const state: ParserState = {
    current_files: orig,
    lines,
    index: 1,
    patch: { actions: {} },
    fuzz: 0,
  };

  while (!isDone(state, ['*** End Patch'])) {
    let filePath = readStr(state, '*** Update File: ');
    if (filePath) {
      if (filePath in state.patch.actions) throw new DiffError(`Update File Error: Duplicate Path: ${filePath}`);
      const moveTo = readStr(state, '*** Move to: ');
      if (!(filePath in state.current_files)) throw new DiffError(`Update File Error: Missing File: ${filePath}`);
      const action = parseUpdateFile(state, state.current_files[filePath]);
      action.move_path = moveTo || null;
      state.patch.actions[filePath] = action;
      continue;
    }

    filePath = readStr(state, '*** Delete File: ');
    if (filePath) {
      if (filePath in state.patch.actions) throw new DiffError(`Delete File Error: Duplicate Path: ${filePath}`);
      if (!(filePath in state.current_files)) throw new DiffError(`Delete File Error: Missing File: ${filePath}`);
      state.patch.actions[filePath] = { type: 'delete' };
      continue;
    }

    filePath = readStr(state, '*** Add File: ');
    if (filePath) {
      if (filePath in state.patch.actions) throw new DiffError(`Add File Error: Duplicate Path: ${filePath}`);
      state.patch.actions[filePath] = parseAddFile(state);
      continue;
    }

    throw new DiffError(`Unknown Line: ${state.lines[state.index]}`);
  }

  if (!startswith(state, ['*** End Patch'])) throw new DiffError('Missing End Patch');
  state.index += 1;

  return { patch: state.patch, fuzz: state.fuzz };
};

const identifyFilesNeeded = (text: string): string[] => {
  const lines = text.trim().split('\n');
  const result = new Set<string>();
  for (const line of lines) {
    if (line.startsWith('*** Update File: ')) result.add(line.slice('*** Update File: '.length));
    if (line.startsWith('*** Delete File: ')) result.add(line.slice('*** Delete File: '.length));
  }
  return Array.from(result);
};

const loadFiles = async (paths: string[], openFn: (p: string) => Promise<string>): Promise<Record<string, string>> => {
  const orig: Record<string, string> = {};
  for (const p of paths) {
    try {
      orig[p] = await openFn(p);
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? (e as { code?: unknown }).code : undefined;
      if (code === 'ENOENT') {
        throw new DiffError(`Delete File Error: Missing File: ${p}`);
      }
      throw e;
    }
  }
  return orig;
};

const getUpdatedFile = (text: string, action: PatchAction, pathLabel: string): string => {
  if (action.type !== 'update' || !action.chunks) throw new DiffError('Invalid patch action');
  const origLines = text.split('\n');
  const destLines: string[] = [];
  let origIndex = 0;
  let destIndex = 0;

  for (const chunk of action.chunks) {
    if (chunk.orig_index > origLines.length) {
      throw new DiffError(
        `_get_updated_file: ${pathLabel}: chunk.orig_index ${chunk.orig_index} > len(lines) ${origLines.length}`,
      );
    }
    if (origIndex > chunk.orig_index) {
      throw new DiffError(
        `_get_updated_file: ${pathLabel}: orig_index ${origIndex} > chunk.orig_index ${chunk.orig_index}`,
      );
    }

    destLines.push(...origLines.slice(origIndex, chunk.orig_index));
    const delta = chunk.orig_index - origIndex;
    origIndex += delta;
    destIndex += delta;

    if (chunk.ins_lines.length) {
      destLines.push(...chunk.ins_lines);
      destIndex += chunk.ins_lines.length;
    }

    origIndex += chunk.del_lines.length;
  }

  destLines.push(...origLines.slice(origIndex));
  const delta = origLines.length - origIndex;
  origIndex += delta;
  destIndex += delta;

  if (origIndex !== origLines.length || destIndex !== destLines.length) {
    throw new DiffError(`_get_updated_file: ${pathLabel}: index mismatch`);
  }

  return destLines.join('\n');
};

const patchToCommit = (patch: Patch, orig: Record<string, string>): ApplyPatchCommit => {
  const commit: ApplyPatchCommit = { changes: {} };
  for (const [p, action] of Object.entries(patch.actions)) {
    if (action.type === 'delete') {
      commit.changes[p] = { type: 'delete', old_content: orig[p] };
    } else if (action.type === 'add') {
      commit.changes[p] = { type: 'add', new_content: action.new_file ?? '' };
    } else {
      const newContent = getUpdatedFile(orig[p], action, p);
      commit.changes[p] = {
        type: 'update',
        old_content: orig[p],
        new_content: newContent,
        move_path: action.move_path ?? null,
      };
    }
  }
  return commit;
};

const applyCommit = async (
  commit: ApplyPatchCommit,
  writeFn: (p: string, content: string) => Promise<void>,
  removeFn: (p: string) => Promise<void>,
): Promise<void> => {
  for (const [p, change] of Object.entries(commit.changes)) {
    if (change.type === 'delete') {
      await removeFn(p);
    } else if (change.type === 'add') {
      await writeFn(p, change.new_content ?? '');
    } else if (change.type === 'update') {
      const content = change.new_content ?? '';
      if (change.move_path) {
        await writeFn(change.move_path, content);
        await removeFn(p);
      } else {
        await writeFn(p, content);
      }
    }
  }
};

const processPatch = async (
  text: string,
  openFn: (p: string) => Promise<string>,
  writeFn: (p: string, content: string) => Promise<void>,
  removeFn: (p: string) => Promise<void>,
): Promise<{ message: string; fuzz: number; commit: ApplyPatchCommit }> => {
  if (!text.startsWith('*** Begin Patch')) {
    throw new DiffError('Invalid patch text');
  }
  const paths = identifyFilesNeeded(text);
  const orig = await loadFiles(paths, openFn);
  const { patch, fuzz } = parsePatchText(text, orig);
  const commit = patchToCommit(patch, orig);
  await applyCommit(commit, writeFn, removeFn);
  return { message: 'Done!', fuzz, commit };
};

export class ApplyPatchTool extends ZodTool<ApplyPatchArgs, ApplyPatchResult> {
  readonly name = 'apply_patch';
  readonly description = TOOL_DESCRIPTION;
  readonly schema = applyPatchSchema;

  async execute(args: ApplyPatchArgs, context: ToolContext): Promise<ApplyPatchResult> {
    const ws = context.workspace;

    const resolve = (p: string): string => {
      try {
        return ws.resolvePath(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/escapes workspace root/i.test(msg)) {
          throw new DiffError('Absolute or escaping paths are not allowed');
        }
        throw e;
      }
    };

    const openFn = async (p: string): Promise<string> => {
      const resolved = resolve(p);
      return await fs.readFile(resolved, 'utf8');
    };

    const writeFn = async (p: string, content: string): Promise<void> => {
      const resolved = resolve(p);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf8');
    };

    const removeFn = async (p: string): Promise<void> => {
      const resolved = resolve(p);
      await fs.unlink(resolved);
    };

    const result = await processPatch(args.patch, openFn, writeFn, removeFn);
    return result;
  }
}

