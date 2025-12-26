import * as vscode from 'vscode';
import type { ConversationInstance } from '@openhands/agent-sdk-ts';

export function createFileEditNoteTracker(opts: {
  getConversation: () => ConversationInstance | undefined;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
  getGitHeadDiffSummaryForFile: (filePath: string) => Promise<string>;
}) {
  const agentEditedFiles = new Set<string>();
  const lastUserEditNoteAtMs = new Map<string, number>();
  const USER_EDIT_NOTE_DEBOUNCE_MS = 5000;

  const trackAgentEditedFile = (filePath: string) => {
    agentEditedFiles.add(filePath);
  };

  const reset = () => {
    agentEditedFiles.clear();
    lastUserEditNoteAtMs.clear();
  };

  const onDidSaveTextDocument = (document: vscode.TextDocument) => {
    void (async () => {
      const activeConversation = opts.getConversation();
      if (!activeConversation?.getConversationId()) return;
      if (document.uri.scheme !== 'file') return;

      const filePath = document.uri.fsPath;
      if (!agentEditedFiles.has(filePath)) return;

      const now = Date.now();
      const last = lastUserEditNoteAtMs.get(filePath);
      if (typeof last === 'number' && now - last < USER_EDIT_NOTE_DEBOUNCE_MS) return;
      lastUserEditNoteAtMs.set(filePath, now);

      const diffSummary = await opts.getGitHeadDiffSummaryForFile(filePath);
      const note = ['Environment note: user edited file:', filePath, diffSummary].join('\n');
      try {
        await activeConversation.sendUserMessage(note, { run: false });
      } catch (err) {
        opts.getOutputChannel()?.appendLine(`[error] Failed to record user edit note: ${opts.renderError(err)}`);
      }
    })();
  };

  return { trackAgentEditedFile, reset, onDidSaveTextDocument };
}

