import * as vscode from 'vscode';
import * as fs from 'fs';
import { pollUntil } from './pollUntil';

type DiagnosticsInfo = {
  chat?: { hasView?: boolean; webviewReady?: boolean };
  mode?: string;
  serverUrl?: string;
  status?: string;
  conversationId?: string;
};

type WebviewActionResult = {
  sent?: boolean;
};

type ConversationInfoResponse = {
  agent?: {
    llm?: {
      model?: unknown;
      base_url?: unknown;
    };
  };
};

type SavedState = {
  conversationId: string;
  profileA: string;
  modelA: string;
  baseUrlA: string;
};

export async function run(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL;
  if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) {
    throw new Error('Missing required env var: AGENT_SERVER_URL');
  }

  const mockABase = process.env.E2E_MOCK_LLM_A_BASE_URL;
  if (typeof mockABase !== 'string' || !mockABase.trim()) {
    throw new Error('Missing required env var: E2E_MOCK_LLM_A_BASE_URL');
  }

  const stateFile = process.env.E2E_STATE_FILE;
  if (typeof stateFile !== 'string' || !stateFile.trim()) {
    throw new Error('Missing required env var: E2E_STATE_FILE');
  }
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Missing state file: ${stateFile}`);
  }

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Partial<SavedState>;
  const conversationId = typeof state.conversationId === 'string' ? state.conversationId : '';
  const profileA = typeof state.profileA === 'string' ? state.profileA : '';
  const modelA = typeof state.modelA === 'string' ? state.modelA : '';
  const baseUrlA = typeof state.baseUrlA === 'string' ? state.baseUrlA : '';
  if (!conversationId || !profileA || !modelA || !baseUrlA) {
    throw new Error(`Invalid state file: ${stateFile}`);
  }

  const fetchConversationInfo = async (id: string): Promise<ConversationInfoResponse> => {
    const base = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/conversations/${id}`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET /api/conversations/${id} failed: HTTP ${res.status}`);
    return await res.json() as ConversationInfoResponse;
  };

  const fetchMockRequestCount = async (base: string): Promise<number> => {
    const res = await fetch(`${base.replace(/\/+$/, '')}/__log`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET ${base}/__log failed: HTTP ${res.status}`);
    const data = await res.json() as { requests?: unknown };
    const requests = Array.isArray(data?.requests) ? data.requests : [];
    return requests.length;
  };

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

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

  const mockBeforeA = await fetchMockRequestCount(mockABase);

  await vscode.commands.executeCommand('openhands._restoreConversation', { conversationId });
  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.status === 'online' && diag?.conversationId === conversationId;
  }, 60000);

  await vscode.commands.executeCommand('openhands._selectProfile', { profileId: profileA });

  const normalizeUrl = (value: unknown): string => typeof value === 'string' ? value.replace(/\/+$/, '') : '';
  await pollUntil(async () => {
    const info = await fetchConversationInfo(conversationId);
    return info.agent?.llm?.model === modelA && normalizeUrl(info.agent?.llm?.base_url) === normalizeUrl(baseUrlA);
  }, 20000);

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (agent-server remote restore + new LLM).' }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  await pollUntil(async () => (await fetchMockRequestCount(mockABase)) > mockBeforeA, 15000, 200);

  console.log('✓ Remote agent-server restore + LLM switch E2E test passed');
}

