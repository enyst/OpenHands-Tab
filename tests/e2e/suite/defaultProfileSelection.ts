import * as assert from 'assert';
import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 15000);

    const cfg = vscode.workspace.getConfiguration();
    const update = async (key: string, value: unknown): Promise<void> => {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    };

    // Force local mode + short runs for E2E.
    await update('openhands.serverUrl', '');
    await update('openhands.conversation.maxIterations', 5);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);

    // Ensure the default profile exists and points at the mock server (avoid real network).
    const v1BaseUrl = `${mock.baseUrl}/v1`;
    try {
      await vscode.commands.executeCommand('openhands._updateProfile', {
        profileId: 'sonnet-45',
        patch: { baseUrl: v1BaseUrl, model: 'claude-e2e' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('not found')) throw error;
      await vscode.commands.executeCommand('openhands._createProfile', {
        profileId: 'sonnet-45',
        profile: {
          provider: 'anthropic',
          model: 'claude-e2e',
          baseUrl: v1BaseUrl,
        },
      });
    }

    // Clear selection and assert the extension defaults it back to a non-empty profileId.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });

    await pollUntil(async () => {
      const inspected = cfg.inspect<string>('openhands.llm.profileId');
      return typeof inspected?.globalValue === 'string' && inspected.globalValue.length > 0;
    }, 15000);

    const inspected = cfg.inspect<string>('openhands.llm.profileId');
    assert.strictEqual(inspected?.globalValue, 'sonnet-45');

    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    await sendAndWaitForRequestPath({
      text: 'E2E default profile selection: anthropic (sonnet-45)',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });
  } finally {
    await mock.close();
  }
}
