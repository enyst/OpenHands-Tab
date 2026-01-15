import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { startOpenAiToolCallsMockServer } from './helpers/openAiToolCallsServer';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

type WebviewActionResult = { sent?: boolean };

type LastObservationInfo = {
  seq?: number;
  tool_name?: unknown;
  tool_call_id?: unknown;
  observationText?: unknown;
} | null;

export async function run(): Promise<void> {
  const mainMock = await startOpenAiToolCallsMockServer({
    toolCalls: [
      {
        name: 'ask_oracle',
        args: {
          question: 'What does the oracle think?',
          context: 'E2E: oracle configured test',
        },
      },
    ],
  });
  const oracleMock = await startMockLlmServer();

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

    await update('openhands.serverUrl', '');
    await update('openhands.conversation.maxIterations', 1);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);
    await update('openhands.agent.summarizeToolCalls', false);

    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-oracle-configured-main',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: `${mainMock.baseUrl}/v1`,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-oracle-configured-main',
      apiKey: 'e2e-oracle-configured-main-key',
    });

    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-oracle-configured-oracle',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: `${oracleMock.baseUrl}/v1`,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-oracle-configured-oracle',
      apiKey: 'e2e-oracle-configured-oracle-key',
    });

    await update('openhands.oracle.profileId', 'e2e-oracle-configured-oracle');

    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-oracle-configured-main' });
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    const setTools = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'setEnabledTools',
      payload: { toolIds: ['ask_oracle'] },
    });
    if (!setTools?.sent) {
      throw new Error(`setEnabledTools action was not sent: ${JSON.stringify(setTools)}`);
    }

    const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'sendMessage',
      payload: { text: 'E2E oracleConfigured: trigger ask_oracle tool call' },
    });
    if (!send?.sent) {
      throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
    }

    await pollUntil(async () => {
      const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
        tool_name: 'ask_oracle',
      });
      const text = typeof info?.observationText === 'string' ? info.observationText : '';
      return text.includes('OK (chat_completions)');
    }, 15000);

    const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
      tool_name: 'ask_oracle',
    });
    const text = typeof info?.observationText === 'string' ? info.observationText : '';
    if (!text.includes('OK (chat_completions)')) {
      throw new Error(`Expected ask_oracle observation to contain oracle answer; got: ${JSON.stringify(info)}`);
    }

    if (mainMock.requests.length !== 1) {
      const recent = mainMock.requests.map((r) => `${r.method} ${r.path}`).join(', ');
      throw new Error(`Expected exactly 1 main LLM request; got ${mainMock.requests.length}: ${recent}`);
    }

    if (oracleMock.requests.length !== 1) {
      const recent = oracleMock.requests.map((r) => `${r.method} ${r.path}`).join(', ');
      throw new Error(`Expected exactly 1 oracle LLM request; got ${oracleMock.requests.length}: ${recent}`);
    }

    const oracleReq = oracleMock.requests[0];
    if (oracleReq?.method !== 'POST') {
      throw new Error(`Expected oracle request method POST; got ${oracleReq?.method ?? 'unknown'}`);
    }
    if (!oracleReq?.path?.endsWith('/chat/completions')) {
      throw new Error(`Expected oracle request path to end with /chat/completions; got ${oracleReq?.path ?? 'unknown'}`);
    }
    if (!oracleReq?.bodyText?.includes('You are an Oracle')) {
      throw new Error('Expected oracle request to include the Oracle system prompt');
    }
  } finally {
    await mainMock.close();
    await oracleMock.close();
  }
}
