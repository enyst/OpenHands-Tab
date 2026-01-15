import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { normalizeNonEmptyString } from '../shared/stringUtils';
import { getEffectiveWorkspaceRoot } from '../shared/workspaceRoot';
import { migrateWorkspaceConversationStore } from './conversationStoreMigration';

function resolveConfiguredPath(p: string): string {
  const raw = p.trim();
  if (raw.startsWith('~/') || raw === '~') {
    const suffix = raw === '~' ? '' : raw.slice(2);
    return path.join(os.homedir(), suffix);
  }
  if (raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  if (path.isAbsolute(raw)) return raw;
  // Prefer homedir-relative resolution so behavior is stable even with no workspace open.
  return path.resolve(os.homedir(), raw);
}

async function ensureWritableDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.openhands-write-probe-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, 'ok', 'utf8');
  await fs.unlink(probe);
}

export async function resolveConversationStoreRoot(params: {
  context: vscode.ExtensionContext;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
}): Promise<string> {
  const cfg = vscode.workspace.getConfiguration();
  const configured = normalizeNonEmptyString(cfg.get<string>('openhands.conversation.storeRoot'));

  const candidates: Array<{ label: string; dir: string }> = [];
  if (configured) {
    candidates.push({ label: 'setting openhands.conversation.storeRoot', dir: resolveConfiguredPath(configured) });
  }

  try {
    candidates.push({ label: 'default ~/.openhands/conversations-vscode', dir: path.join(os.homedir(), '.openhands', 'conversations-vscode') });
  } catch (err) {
    params.getOutputChannel()?.appendLine(`[storage] Failed to compute home dir default: ${params.renderError(err)}`);
  }

  const globalStorage = (params.context as unknown as { globalStorageUri?: vscode.Uri }).globalStorageUri?.fsPath;
  if (globalStorage) {
    candidates.push({ label: 'VS Code globalStorageUri', dir: path.join(globalStorage, 'conversations') });
  }

  candidates.push({ label: 'os.tmpdir()', dir: path.join(os.tmpdir(), 'openhands-conversations-vscode') });

  for (const candidate of candidates) {
    try {
      await ensureWritableDirectory(candidate.dir);

      // One-time best-effort migration away from legacy workspace persistence.
      // This keeps restore working for users who previously wrote to `./.openhands/conversations`.
      const workspaceRoot = getEffectiveWorkspaceRoot();
      if (workspaceRoot) {
        const resolvedCandidate = path.resolve(candidate.dir);
        const resolvedWorkspace = path.resolve(workspaceRoot);
        const candidateIsWithinWorkspace =
          resolvedCandidate === resolvedWorkspace || resolvedCandidate.startsWith(`${resolvedWorkspace}${path.sep}`);
        if (!candidateIsWithinWorkspace) {
          try {
            await migrateWorkspaceConversationStore({
              workspaceRoot,
              targetRoot: candidate.dir,
              log: (line) => params.getOutputChannel()?.appendLine(line),
            });
          } catch (err) {
            params.getOutputChannel()?.appendLine(`[storage] Failed to migrate legacy workspace conversations: ${params.renderError(err)}`);
          }
        }
      }

      if (candidate.dir !== candidates[0]?.dir) {
        params.getOutputChannel()?.appendLine(`[storage] Using conversation store root: ${candidate.dir} (${candidate.label})`);
      }
      return candidate.dir;
    } catch (err) {
      params.getOutputChannel()?.appendLine(`[storage] Cannot use ${candidate.label} (${candidate.dir}): ${params.renderError(err)}`);
    }
  }

  // Last resort: return tmp path even if we couldn't probe it; conversation may still run without persistence.
  return path.join(os.tmpdir(), 'openhands-conversations-vscode');
}
