import * as vscode from 'vscode';
import type { ConversationInstance } from '@smolpaws/agent-sdk';

export function createFileEditNoteTracker(opts: {
  getConversation: () => ConversationInstance | undefined;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
  getGitHeadDiffSummaryForFile: (filePath: string) => Promise<string>;
}) {
  const agentEditedFiles = new Set<string>();
  const lastUserEditNoteAtMs = new Map<string, number>();
  const USER_EDIT_NOTE_DEBOUNCE_MS = 5000;
  const queuedUserEditNotes: string[] = [];

  const trackAgentEditedFile = (filePath: string) => {
    agentEditedFiles.add(filePath);
  };

  const reset = () => {
    agentEditedFiles.clear();
    lastUserEditNoteAtMs.clear();
    queuedUserEditNotes.length = 0;
  };

  const getQueuedUserEditNotes = (): string[] => queuedUserEditNotes.slice();
  const clearQueuedUserEditNotes = (): void => { queuedUserEditNotes.length = 0; };

  const onDidSaveTextDocument = async (document: vscode.TextDocument): Promise<void> => {
    const activeConversation = opts.getConversation();
    if (!activeConversation?.getConversationId()) return;
    if (activeConversation.mode !== 'local') return;

    const scheme = document.uri.scheme;
    if (scheme !== 'file' && scheme !== 'vscode-remote') return;

    const filePath = document.uri.fsPath;
    if (!agentEditedFiles.has(filePath)) return;

    const now = Date.now();
    const last = lastUserEditNoteAtMs.get(filePath);
    if (typeof last === 'number' && now - last < USER_EDIT_NOTE_DEBOUNCE_MS) return;
    lastUserEditNoteAtMs.set(filePath, now);

    try {
      const diffSummary = await opts.getGitHeadDiffSummaryForFile(filePath);
      const note = ['Environment note: user edited file:', filePath, diffSummary].join('\n');
      queuedUserEditNotes.push(note);
    } catch (err) {
      opts.getOutputChannel()?.appendLine(`[error] Failed to record user edit note: ${opts.renderError(err)}`);
    }
  };

  return { trackAgentEditedFile, reset, getQueuedUserEditNotes, clearQueuedUserEditNotes, onDidSaveTextDocument };
}
