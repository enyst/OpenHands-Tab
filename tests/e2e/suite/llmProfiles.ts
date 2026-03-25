import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

type WebviewActionResult = {
  sent?: boolean;
};

type ErrorInfo = { seq?: number; code?: unknown; detail?: unknown; error?: unknown } | null;

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
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

    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    // Create profiles used by this suite.
    // Note: the extension is profiles-only for provider/model/baseUrl/tuning, so all profiles must
    // point at the mock LLM server.
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-anthropic',
      profile: {
        provider: 'anthropic',
        model: 'claude-e2e',
        baseUrl: v1BaseUrl,
      },
    });

    const openaiProfileKey = 'e2e-profile-openai-key';

    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-chat',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-openai-chat',
      apiKey: openaiProfileKey,
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
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-openai-responses',
      apiKey: openaiProfileKey,
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-delete',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-openai-delete',
      apiKey: openaiProfileKey,
    });

    // Switch to Anthropic profile (baseline).
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-anthropic' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 1: profile (anthropic)',
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

    // UI flow regression coverage (oh-tab-7svy):
    // - Creating/saving a profile should update the Conversation dropdown list.
    // - Selecting a profile should be applied before the next message is sent.
    //   (This must hold even when switching between two OpenAI profiles, where request path alone
    //   would not catch a stale model.)
    const uiProfileId = `e2e-ui-openai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const uiProfileModel = 'gpt-5-mini';

    await vscode.commands.executeCommand('openhands._webviewAction', {
      action: 'openLlmProfilesView',
      payload: { mode: 'create' },
    });

    await vscode.commands.executeCommand('openhands._webviewAction', {
      action: 'saveLlmProfile',
      payload: {
        profileId: uiProfileId,
        profile: {
          provider: 'openai',
          model: uiProfileModel,
          baseUrl: v1BaseUrl,
          openaiApiMode: 'chat_completions',
        },
      },
    });

    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: uiProfileId,
      apiKey: openaiProfileKey,
    });

    // Close and reopen the panel to force a list refresh (the dropdown should still update).
    await vscode.commands.executeCommand('openhands._webviewAction', { action: 'closeLlmProfilesView' });
    await vscode.commands.executeCommand('openhands._webviewAction', {
      action: 'openLlmProfilesView',
      payload: { mode: 'create' },
    });

    await pollUntil(async () => {
      const ui = await vscode.commands.executeCommand<any>('openhands._queryUiState');
      return Array.isArray(ui?.llmProfiles) && ui.llmProfiles.includes(uiProfileId);
    }, 15000);

    // Select via UI and immediately send to verify no race.
    await vscode.commands.executeCommand('openhands._webviewAction', {
      action: 'setLlmProfileId',
      payload: { profileId: uiProfileId },
    });

    const uiRequest = await sendAndWaitForRequestPath({
      text: 'E2E profiles UI step: openai selected via UI',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });

    const usedModel = (uiRequest.json as { model?: unknown } | undefined)?.model;
    if (usedModel !== uiProfileModel) {
      throw new Error(`Expected model '${uiProfileModel}' but got '${String(usedModel)}' in request: ${JSON.stringify(uiRequest.json)}`);
    }

    await pollUntil(async () => {
      const active = vscode.workspace.getConfiguration('openhands').get<string>('llm.profileId');
      return active === uiProfileId;
    }, 15000);

    await pollUntil(async () => {
      const ui = await vscode.commands.executeCommand<any>('openhands._queryUiState');
      return ui?.llmProfileId === uiProfileId;
    }, 15000);

    await vscode.commands.executeCommand('openhands._webviewAction', { action: 'closeLlmProfilesView' });


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

    // Return to the Anthropic profile.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-anthropic' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 5: back to anthropic profile',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });

    const sendAndExpectErrorCode = async (options: { text: string; expectedCode: string; timeoutMs?: number }) => {
      const { text, expectedCode, timeoutMs = 45000 } = options;
      const beforeReqCount = mock.requests.length;
      const beforeError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
      const beforeErrorSeq = typeof beforeError?.seq === 'number' ? beforeError.seq : -1;

      const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
        action: 'sendMessage',
        payload: { text },
      });
      if (!send?.sent) {
        throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
      }

      await pollUntil(async () => {
        const afterError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
        const afterSeq = typeof afterError?.seq === 'number' ? afterError.seq : -1;
        if (!afterError || afterSeq <= beforeErrorSeq) return false;
        return afterError.code === expectedCode;
      }, timeoutMs, 200);

      const afterError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
      if (!afterError) throw new Error('Expected an error event after sending message, but none was found');
      if (afterError.code !== expectedCode) {
        throw new Error(`Expected error code ${expectedCode} but got ${String(afterError.code)} (${JSON.stringify(afterError)})`);
      }
      if (mock.requests.length !== beforeReqCount) {
        const recent = mock.requests.slice(beforeReqCount).map((r) => ({ method: r.method, path: r.path }));
        throw new Error(`Expected no mock requests after error, but saw: ${JSON.stringify(recent)}`);
      }
      return afterError;
    };

    // Delete profile: should clear selection + remove stored key.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-delete' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 6: delete target profile (openai chat_completions)',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });

    await vscode.commands.executeCommand('openhands._deleteProfile', { profileId: 'e2e-openai-delete' });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-anthropic' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 7: after delete uses anthropic profile',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });

    // Recreate profile without setting a key; selecting it should trigger missing_llm_api_key.
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-delete',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-delete' });
    await sendAndExpectErrorCode({
      text: 'E2E profiles step 8: recreated profile missing key',
      expectedCode: 'missing_llm_api_key',
    });
  } finally {
    await mock.close();
  }
}
