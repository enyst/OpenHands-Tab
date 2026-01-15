import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';

type LastUserMessageInfo = {
  seq: number;
  contentTextPreview: string;
  extendedContentTextPreview: string;
  extendedContentCount: number;
} | null;

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');
  await waitForDiagnostics({
    label: 'chat view ready',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
  });

  await vscode.commands.executeCommand('openhands.startNewConversation');
  await waitForDiagnostics({
    label: 'after startNewConversation',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.chat?.webviewReady),
  });

  const contentText = 'E2E lastUserMessage: content text';
  const extendedText = 'E2E lastUserMessage: extended content';

  await vscode.commands.executeCommand('openhands._sendTestEvent', {
    kind: 'MessageEvent',
    source: 'user',
    llm_message: { role: 'user', content: [{ type: 'text', text: contentText }] },
    extended_content: [{ type: 'text', text: extendedText }],
  });

  await pollUntil(async () => {
    const info = await vscode.commands.executeCommand<LastUserMessageInfo>('openhands._queryLastUserMessage');
    return Boolean(
      info &&
        typeof info.seq === 'number' &&
        info.extendedContentCount === 1 &&
        info.contentTextPreview.includes(contentText) &&
        info.extendedContentTextPreview.includes(extendedText),
    );
  }, 15000);

  const info = await vscode.commands.executeCommand<LastUserMessageInfo>('openhands._queryLastUserMessage');
  if (!info) throw new Error('Expected openhands._queryLastUserMessage to return a payload');
  if (info.extendedContentCount !== 1) {
    throw new Error(`Expected extendedContentCount to be 1, got ${info.extendedContentCount}`);
  }
  if (!info.contentTextPreview.includes(contentText)) {
    throw new Error(`Expected contentTextPreview to include content text, got: ${JSON.stringify(info)}`);
  }
  if (!info.extendedContentTextPreview.includes(extendedText)) {
    throw new Error(`Expected extendedContentTextPreview to include extended content, got: ${JSON.stringify(info)}`);
  }
}

