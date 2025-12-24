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
    await update('openhands.conversation.maxIterations', 10);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);

    const v1BaseUrl = `${mock.baseUrl}/v1`;

    // Base LLM config (used when no profile is selected).
    await update('openhands.llm.profileId', '');
    await update('openhands.llm.provider', 'anthropic');
    await update('openhands.llm.model', 'claude-e2e');
    await update('openhands.llm.baseUrl', v1BaseUrl);

    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    // Create profiles used by this suite.
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-chat',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-responses',
      profile: {
        provider: 'openai',
        model: 'gpt-5-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'responses',
      },
    });

    // No profile selected: should use the base anthropic config.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 1: base (anthropic)',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });

    // Select a profile and verify subsequent calls use it.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-chat' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 2: profile (openai chat_completions)',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });

    // Update profile config and verify it takes effect after re-selecting.
    await vscode.commands.executeCommand('openhands._updateProfile', {
      profileId: 'e2e-openai-chat',
      patch: { openaiApiMode: 'responses', model: 'gpt-5-mini' },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-chat' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 3: updated profile (openai responses)',
      expectedPath: '/v1/responses',
      getRequests: () => mock.requests,
    });

    // Switch to a second profile.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-responses' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 4: second profile (openai responses)',
      expectedPath: '/v1/responses',
      getRequests: () => mock.requests,
    });

    // Clearing selection returns to base config again.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 5: base again (anthropic)',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });
  } finally {
    await mock.close();
  }
}
