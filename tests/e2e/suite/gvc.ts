import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';

type DiagnosticsInfo = {
  chat?: { hasView?: boolean; webviewReady?: boolean };
  conversationId?: string | null;
  mode?: 'local' | 'remote';
};

function extractUserMessageTexts(json: unknown): string[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const obj = json as Record<string, unknown>;
  const messages = obj.messages;
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return [];
    const msg = m as Record<string, unknown>;
    if (msg.role !== 'user') return [];

    const content = msg.content;
    if (typeof content === 'string') return [content];
    if (!Array.isArray(content)) return [];

    const parts = content.flatMap((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
      const part = p as Record<string, unknown>;
      const text = part.text;
      return typeof text === 'string' ? [text] : [];
    });
    return parts.length ? [parts.join('')] : [];
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebviewReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: DiagnosticsInfo | undefined;

  while (Date.now() < deadline) {
    last = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    if (last?.chat?.hasView && last.chat.webviewReady) return;
    await sleep(200);
  }

  throw new Error(`Timed out waiting for chat webview readiness. diagnostics=${JSON.stringify(last)}`);
}

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  let tempUri: vscode.Uri | undefined;

  try {
    await vscode.commands.executeCommand('openhands.open');
    await waitForWebviewReady(30000);

    // Force local mode + short runs for E2E.
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.conversation.maxIterations', 5, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'never', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.agent.enableSecurityAnalyzer', false, vscode.ConfigurationTarget.Global);

    // Create a profile that points at the mock server.
    const v1BaseUrl = `${mock.baseUrl}/v1`;
    const profileId = 'e2e-gvc-openai';
    await vscode.commands.executeCommand('openhands._setProviderApiKey', { provider: 'openai', apiKey: 'sk-e2e-openai' });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId,
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId });
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    await pollUntil(async () => {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      return diag?.mode === 'local' && typeof diag?.conversationId === 'string' && diag.conversationId.length > 0;
    }, 30000);

    const filePath = path.join(os.tmpdir(), `e2e-gvc-${Date.now().toString(36)}.txt`);
    tempUri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(tempUri, Buffer.from('initial\n'));

    const doc = await vscode.workspace.openTextDocument(tempUri);
    await vscode.window.showTextDocument(doc, { preview: false });

    // Ensure no prior traffic makes assertions flaky.
    mock.reset();

    // Mark as agent-edited, then save a user edit to queue a watched-file note.
    await vscode.commands.executeCommand('openhands._testMarkAgentEditedFile', { fsPath: filePath });

    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Expected an active editor');
    const end = doc.lineAt(doc.lineCount - 1).range.end;
    await editor.edit((edit) => {
      edit.insert(end, `user edit ${Date.now().toString(36)}\n`);
    });
    await doc.save();

    // The save should only queue a note; it must not trigger an LLM request by itself.
    await sleep(500);
    if (mock.requests.length !== 0) {
      throw new Error(`Expected no LLM requests after save, but saw ${mock.requests.length}`);
    }

    // First send should include the queued note via extended_content.
    const first = await sendAndWaitForRequestPath({
      text: 'E2E gvc step 1',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });
    const firstUsers = extractUserMessageTexts(first.json);
    const hasNote = firstUsers.some((t) => t.includes('Environment note: user edited file:') && t.includes(filePath));
    if (!hasNote) {
      throw new Error(`Expected first request to contain queued watched-file note. userTexts=${JSON.stringify(firstUsers)}`);
    }

    // Second send should not include stale notes (queue drained).
    const second = await sendAndWaitForRequestPath({
      text: 'E2E gvc step 2',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });
    const secondUsers = extractUserMessageTexts(second.json);
    const noteCount = secondUsers.filter((t) => t.includes('Environment note: user edited file:')).length;
    if (noteCount !== 1) {
      throw new Error(`Expected note to appear exactly once in conversation history. userTexts=${JSON.stringify(secondUsers)}`);
    }
  } finally {
    if (tempUri) {
      try {
        await vscode.workspace.fs.delete(tempUri, { useTrash: false });
      } catch {
        // ignore
      }
    }
    await mock.close();
  }
}
