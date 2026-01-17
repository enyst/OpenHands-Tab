import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

type RenderedEventsInfo = {
  count?: number;
  eventTypes?: unknown[];
};

type WebviewActionResult = {
  sent?: boolean;
};

async function resetMock(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/__reset`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to reset mock server (HTTP ${res.status})${body ? `: ${body}` : ''}`);
  }
}

async function getMockRequestCount(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl}/__log`, { method: 'GET' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch mock log (HTTP ${res.status})${body ? `: ${body}` : ''}`);
  }
  const json = await res.json() as { requests?: unknown };
  const requests = Array.isArray(json.requests) ? json.requests : [];
  return requests.length;
}

export async function run(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL;
  if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) {
    throw new Error('Missing required env var: AGENT_SERVER_URL');
  }
  const mockBaseUrl = process.env.MOCK_LLM_BASE_URL;
  if (typeof mockBaseUrl !== 'string' || mockBaseUrl.trim().length === 0) {
    throw new Error('Missing required env var: MOCK_LLM_BASE_URL');
  }

  await resetMock(mockBaseUrl);

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  const profileId = `e2e-agent-server-remote-openai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await vscode.commands.executeCommand('openhands._createProfile', {
    profileId,
    profile: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: `${mockBaseUrl}/v1`,
      openaiApiMode: 'responses',
    },
  });
  await vscode.workspace.getConfiguration().update('openhands.llm.profileId', profileId, vscode.ConfigurationTarget.Global);

  // Configure remote server and keep the run short.
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
  const beforeRequests = await getMockRequestCount(mockBaseUrl);

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'E2E: force LLM error and ensure ConversationErrorEvent renders.' }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  await pollUntil(async () => {
    const rendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
    const count = typeof rendered?.count === 'number' ? rendered.count : 0;
    const types = Array.isArray(rendered?.eventTypes) ? rendered.eventTypes : [];
    if (count <= beforeCount) return false;
    return types.includes('ConversationErrorEvent') || types.includes('AgentErrorEvent');
  }, 120000);

  await pollUntil(async () => (await getMockRequestCount(mockBaseUrl)) > beforeRequests, 60000);
}
