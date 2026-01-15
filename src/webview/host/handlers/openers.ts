import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import { getEffectiveWorkspaceRoot } from '../../../shared/workspaceRoot';
import { safeParseUri } from '../attachments';
import { showWorkspaceDiff } from '../diffDocuments';
import { resolveGitHeadDiffContents } from '../gitHeadDiff';
import { resolveWorkspaceFilePath } from '../workspacePaths';

function execFileText(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : err.message;
        reject(new Error(message));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

export async function handleOpenSkill(message: Extract<WebviewToHostMessage, { type: 'openSkill' }>): Promise<void> {
  const skillPath = message.path;
  if (!skillPath) return;
  try {
    const skillsRoot = path.resolve(os.homedir(), '.openhands', 'skills');
    const resolvedPath = path.resolve(skillPath);
    const relative = path.relative(skillsRoot, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      void vscode.window.showErrorMessage('Refusing to open skill outside of ~/.openhands/skills');
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to open skill file: ${reason}`);
  }
}

export async function handleOpenWorkspaceFile(message: Extract<WebviewToHostMessage, { type: 'openWorkspaceFile' }>): Promise<void> {
  const p = message.path;
  if (!p) return;
  try {
    const { resolvedPath } = resolveWorkspaceFilePath(p);
    await fs.stat(resolvedPath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to open file: ${reason}`);
  }
}

export async function handleOpenMarkdownLink(message: Extract<WebviewToHostMessage, { type: 'openMarkdownLink' }>): Promise<void> {
  const raw = typeof message.href === 'string' ? message.href.trim() : '';
  if (!raw || raw.startsWith('#')) return;

  // Only allow http(s)/mailto links and workspace-internal file links.
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) {
    const uri = safeParseUri(raw);
    if (!uri || (uri.scheme !== 'http' && uri.scheme !== 'https' && uri.scheme !== 'mailto')) {
      void vscode.window.showErrorMessage('Blocked unsafe link.');
      return;
    }
    await vscode.env.openExternal(uri);
    return;
  }

  const wsRoot = getEffectiveWorkspaceRoot();
  if (!wsRoot) {
    void vscode.window.showErrorMessage('Cannot open link: no workspace folder is open.');
    return;
  }

  const withoutFragment = raw.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  const inputPath = withoutQuery.trim();
  if (!inputPath) return;

  const resolvedPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(wsRoot, inputPath);
  const rel = path.relative(wsRoot, resolvedPath);
  const inWorkspace = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!inWorkspace) {
    void vscode.window.showErrorMessage('Blocked unsafe link.');
    return;
  }

  try {
    await fs.stat(resolvedPath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to open link: ${reason}`);
  }
}

export async function handleOpenWorkspaceDiff(args: {
  context: vscode.ExtensionContext;
  message: Extract<WebviewToHostMessage, { type: 'openWorkspaceDiff' }>;
}): Promise<void> {
  const p = args.message.path;
  if (!p) return;
  if (typeof args.message.oldContent !== 'string' || typeof args.message.newContent !== 'string') {
    void vscode.window.showErrorMessage('Failed to open diff: missing diff content.');
    return;
  }
  try {
    let oldContent = args.message.oldContent;
    let newContent = args.message.newContent;

    if (args.message.preferGitHead === true) {
      const wsRoot = getEffectiveWorkspaceRoot();
      const { resolvedPath } = resolveWorkspaceFilePath(p);
      const resolved = await resolveGitHeadDiffContents({
        workspaceRoot: wsRoot,
        resolvedPath,
        fallbackOldContent: '',
        fallbackNewContent: newContent,
        execFileText,
        readFileText: (filePath) => fs.readFile(filePath, 'utf8'),
      });
      oldContent = resolved.oldContent;
      newContent = resolved.newContent;
    }

    await showWorkspaceDiff({ context: args.context, filePath: p, oldContent, newContent });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Failed to open diff: ${reason}`);
  }
}

