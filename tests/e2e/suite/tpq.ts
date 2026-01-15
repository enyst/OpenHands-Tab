import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';

type DiagnosticsInfo = {
  chat?: { hasView?: boolean; webviewReady?: boolean };
};

function extractEnvInfoBlock(bodyText: string): string | null {
  const start = bodyText.indexOf('<environment information>');
  if (start < 0) return null;
  const end = bodyText.indexOf('</environment information>', start);
  if (end < 0) return null;
  return bodyText.slice(start, end + '</environment information>'.length);
}

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    const activeFile = (process.env.E2E_TPQ_ACTIVE_FILE ?? '').trim();
    if (!activeFile) throw new Error('E2E_TPQ_ACTIVE_FILE is required');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(activeFile));
    await vscode.window.showTextDocument(doc, { preview: false });
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const workspaceFile = (vscode.workspace as any).workspaceFile?.fsPath ?? null;
      throw new Error(`Expected active file to be inside a workspace folder. workspaceFile=${String(workspaceFile)} folders=${JSON.stringify(folders)}`);
    }

    await pollUntil(async () => {
      const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
      if (active !== activeFile) return false;
      return (vscode.window.visibleTextEditors ?? []).some((e) => e?.document?.uri?.fsPath === activeFile);
    }, 15000);

    // Force local mode + short runs for E2E (before opening the chat view, so the initial connection uses these settings).
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.conversation.maxIterations', 5, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'never', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.agent.enableSecurityAnalyzer', false, vscode.ConfigurationTarget.Global);

    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 30000);

    // Create a profile that points at the mock server.
    const v1BaseUrl = `${mock.baseUrl}/v1`;
    const profileId = 'e2e-tpq-openai';
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

    // Reconnect after the target editor is active so env-info uses the correct workspace root.
    await vscode.commands.executeCommand('openhands.reconnect');

    // Start the conversation after the active editor is set, so env-info is built with the correct workspaceRoot.
    await vscode.commands.executeCommand('openhands.startNewConversation');

    mock.reset();

    const req = await sendAndWaitForRequestPath({
      text: 'E2E tpq step 1',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });

    const envBlock = extractEnvInfoBlock(req.bodyText);
    if (!envBlock) {
      throw new Error(`Expected request to contain <environment information> block. bodyText=${req.bodyText}`);
    }

    if (!envBlock.includes('Active editor: foo.md')) {
      throw new Error(`Expected env block to contain workspace-relative active editor label. envBlock=${envBlock}`);
    }

    if (envBlock.includes(activeFile)) {
      throw new Error(`Expected env block to not contain absolute active file path. envBlock=${envBlock}`);
    }
  } finally {
    await mock.close();
  }
}
