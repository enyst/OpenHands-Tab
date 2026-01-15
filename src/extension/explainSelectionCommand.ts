import * as vscode from 'vscode';
import type { ConversationInstance } from '@openhands/agent-sdk-ts';
import { formatEnvironmentInformation } from '../shared/environmentInformation';
import { getEffectiveWorkspaceRoot } from '../shared/workspaceRoot';
import { getFileBackedFsPath } from '../shared/uri';

export function registerExplainSelectionCommand(options: {
  getConversation: () => ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
}): vscode.Disposable {
  const { getConversation, getConversationMode } = options;

  return vscode.commands.registerCommand('openhands.explainSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showErrorMessage('OpenHands: No active editor to explain.');
      return;
    }

    const selection = editor.selection;
    if (!selection || selection.isEmpty) {
      void vscode.window.showErrorMessage('OpenHands: Select code to explain first.');
      return;
    }

    const selectedText = editor.document.getText(selection);
    if (!selectedText.trim()) {
      void vscode.window.showErrorMessage('OpenHands: Selection is empty.');
      return;
    }

    const maxChars = 12_000;
    const truncated =
      selectedText.length > maxChars
        ? `${selectedText.slice(0, maxChars)}\n\n[Truncated ${selectedText.length - maxChars} characters.]`
        : selectedText;

    const languageId = editor.document.languageId;
    const filePath = getFileBackedFsPath(editor.document.uri) ?? editor.document.uri.toString();
    const start = selection.start;
    const end = selection.end;
    const range = `${filePath}:${start.line + 1}:${start.character + 1}-${end.line + 1}:${end.character + 1}`;

    const maxBackticks = Math.max(0, ...Array.from(truncated.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(Math.max(3, maxBackticks + 1));
    const fencedCode = `${fence}${languageId}\n${truncated}\n${fence}`;

    const prompt = [
      'Please explain this code:',
      '',
      `File: ${range}`,
      `Language: ${languageId}`,
      '',
      fencedCode,
    ].join('\n');

    await vscode.commands.executeCommand('openhands.open');
    await vscode.commands.executeCommand('openhands.startNewConversation');
    const conversation = getConversation();
    if (!conversation) {
      void vscode.window.showErrorMessage('OpenHands: Conversation is not available.');
      return;
    }

    let finalPrompt = prompt;
    if (getConversationMode() === 'local') {
      const workspaceRoot = getEffectiveWorkspaceRoot();
      const activeEditorPath = getFileBackedFsPath(vscode.window.activeTextEditor?.document?.uri) ?? null;
      const openEditorPaths = (vscode.window.visibleTextEditors ?? [])
        .map((e) => getFileBackedFsPath(e?.document?.uri))
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      finalPrompt += `\n\n${formatEnvironmentInformation({ workspaceRoot, activeEditorPath, openEditorPaths })}`;
    }

    await conversation.sendUserMessage(finalPrompt);
  });
}
