import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

type RenderedEventsInfo = {
  count?: number;
  eventTypes?: unknown[];
  events?: unknown[];
};

type WebviewActionResult = {
  sent?: boolean;
};

type RenderedEventSnapshot = {
  type?: unknown;
  role?: unknown;
};

export async function run(): Promise<void> {
  const saasUrl = process.env.MOCK_SAAS_URL;
  if (typeof saasUrl !== 'string' || saasUrl.trim().length === 0) {
    throw new Error('Missing required env var: MOCK_SAAS_URL');
  }
  const cloudApiKey = process.env.CLOUD_API_KEY;
  if (typeof cloudApiKey !== 'string' || cloudApiKey.trim().length === 0) {
    throw new Error('Missing required env var: CLOUD_API_KEY');
  }

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  const setCloudKey = await vscode.commands.executeCommand<{ ok?: boolean }>('openhands._e2eSetServerCloudApiKey', {
    serverUrl: saasUrl,
    apiKey: cloudApiKey,
  });
  if (!setCloudKey?.ok) {
    throw new Error('Failed to set cloud api key via openhands._e2eSetServerCloudApiKey');
  }

  await vscode.commands.executeCommand('openhands._serversSet', { servers: [saasUrl], serverUrl: '' });
  await vscode.workspace.getConfiguration().update(
    'openhands.conversation.maxIterations',
    1,
    vscode.ConfigurationTarget.Global
  );

  const selectServer = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'selectServer',
    payload: { url: saasUrl },
  });
  if (!selectServer?.sent) {
    throw new Error(`selectServer action was not sent: ${JSON.stringify(selectServer)}`);
  }

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.serverUrl === saasUrl;
  }, 15000);

  // Cloud bootstrap creates the nested runtime conversation and restore-connects it; do NOT call startNewConversation,
  // which would bypass SaaS and create a fresh runtime conversation.
  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.status === 'online' && typeof diag?.conversationId === 'string';
  }, 120000);

  const before = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  const beforeCount = typeof before?.count === 'number' ? before.count : 0;

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (cloud bootstrap mock SaaS).' }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  type Snapshot = { type: string; role?: string };
  let lastSnapshots: Snapshot[] = [];

  await pollUntil(async () => {
    const rendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
    const count = typeof rendered?.count === 'number' ? rendered.count : 0;
    const snapshots = Array.isArray(rendered?.events) ? rendered.events : [];
    lastSnapshots = snapshots
      .map((snapshot): Snapshot => {
        const record = snapshot as RenderedEventSnapshot;
        const type = typeof record.type === 'string' ? record.type : 'unknown';
        const role = type === 'MessageEvent' && typeof record.role === 'string' ? record.role : undefined;
        return { type, role };
      });

    if (count <= beforeCount) return false;
    const newSnapshots = lastSnapshots.slice(beforeCount);
    const hasUserMessage = newSnapshots.some((event) => event.type === 'MessageEvent' && event.role === 'user');
    const hasRemoteResponse = newSnapshots.some((event) =>
      event.type === 'ConversationErrorEvent' || (event.type === 'MessageEvent' && event.role === 'assistant')
    );
    return hasUserMessage && hasRemoteResponse;
  }, 120000);
}

