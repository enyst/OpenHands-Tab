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
  const serverUrl = process.env.AGENT_SERVER_URL;
  if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) {
    throw new Error('Missing required env var: AGENT_SERVER_URL');
  }
  const runtimeKey = process.env.RUNTIME_SESSION_API_KEY;
  if (typeof runtimeKey !== 'string' || runtimeKey.trim().length === 0) {
    throw new Error('Missing required env var: RUNTIME_SESSION_API_KEY');
  }

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  // Ensure runtime key is present in SecretStorage before selecting the server, so the initial
  // remote conversation is created with the correct auth headers.
  const setKey = await vscode.commands.executeCommand<{ ok?: boolean }>('openhands._e2eSetServerRuntimeSessionApiKey', {
    serverUrl,
    apiKey: runtimeKey,
  });
  if (!setKey?.ok) {
    throw new Error('Failed to set runtime session API key via openhands._e2eSetServerRuntimeSessionApiKey');
  }

  await vscode.commands.executeCommand('openhands._serversSet', { servers: [serverUrl], serverUrl: '' });
  await vscode.workspace.getConfiguration().update(
    'openhands.conversation.maxIterations',
    1,
    vscode.ConfigurationTarget.Global
  );

  const selectServer = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'selectServer',
    payload: { url: serverUrl },
  });
  if (!selectServer?.sent) {
    throw new Error(`selectServer action was not sent: ${JSON.stringify(selectServer)}`);
  }

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.serverUrl === serverUrl;
  }, 15000);

  await vscode.commands.executeCommand('openhands.startNewConversation');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.status === 'online' && typeof diag?.conversationId === 'string';
  }, 45000);

  const before = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  const beforeCount = typeof before?.count === 'number' ? before.count : 0;

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (agent-server remote with auth).' }
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
  }, 60000);
}

