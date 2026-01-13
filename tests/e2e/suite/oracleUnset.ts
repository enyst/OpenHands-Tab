import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockOpenAiToolCallsServer } from './mockLlmServer';

type WebviewActionResult = { sent?: boolean };

type LastObservationInfo = {
  seq?: number;
  tool_name?: unknown;
  tool_call_id?: unknown;
  observationText?: unknown;
} | null;

export async function run(): Promise<void> {
  const now = Date.now();
  const mock = await startMockOpenAiToolCallsServer({
    toolCalls: [
      {
        id: `call_ask_${now}`,
        name: 'ask_oracle',
        args: { question: 'Should we proceed?', context: 'E2E: oracle unset test' },
      },
      {
        id: `call_finish_${now}`,
        name: 'finish',
        args: {},
      },
    ],
  });

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

    // Force local mode + keep runs small + ensure oracle is unset.
    await update('openhands.serverUrl', '');
    await update('openhands.conversation.maxIterations', 5);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);
    await update('openhands.agent.summarizeToolCalls', false);
    await update('openhands.oracle.profileId', '');

    const v1BaseUrl = `${mock.baseUrl}/v1`;
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-oracle-unset-main',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-oracle-unset-main',
      apiKey: 'e2e-oracle-unset-key',
    });

    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-oracle-unset-main' });
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
      payload: { text: 'E2E oracleUnset: trigger tool call' },
    });
    if (!send?.sent) {
      throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
    }

    await pollUntil(async () => {
      const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
        tool_name: 'ask_oracle',
      });
      const text = typeof info?.observationText === 'string' ? info.observationText : '';
      return text.includes('openhands.oracle.profileId');
    }, 15000);

    const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
      tool_name: 'ask_oracle',
    });
    const text = typeof info?.observationText === 'string' ? info.observationText : '';
    if (!text.includes('openhands.oracle.profileId')) {
      throw new Error(`Expected ask_oracle observation to mention openhands.oracle.profileId; got: ${JSON.stringify(info)}`);
    }

    if (mock.requests.length !== 1) {
      const recent = mock.requests.map((r) => `${r.method} ${r.path}`).join(', ');
      throw new Error(`Expected exactly 1 LLM request; got ${mock.requests.length}: ${recent}`);
    }
    if (!mock.requests[0]?.path?.endsWith('/chat/completions')) {
      throw new Error(`Expected request path to end with /chat/completions; got ${mock.requests[0]?.path}`);
    }
  } finally {
    await mock.close();
  }
}
