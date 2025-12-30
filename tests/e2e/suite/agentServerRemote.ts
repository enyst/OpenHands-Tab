import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import * as fs from 'fs';

type DiagnosticsInfo = {
  chat?: { hasView?: boolean; webviewReady?: boolean };
  mode?: string;
  serverUrl?: string;
  status?: string;
  conversationId?: string;
  eventBacklog?: { size?: number };
};

type RenderedEventsInfo = {
  count?: number;
  eventTypes?: unknown[];
  events?: unknown[];
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

type RenderedEventSnapshot = {
  type?: unknown;
  marker?: unknown;
  role?: unknown;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

function containsSubsequence(haystack: unknown[], needle: unknown[]): boolean {
  if (needle.length === 0) return true;
  let needleIndex = 0;
  for (const item of haystack) {
    if (item === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex >= needle.length) return true;
    }
  }
  return false;
}

export async function run(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL;
  if (typeof serverUrl !== 'string' || serverUrl.trim().length === 0) {
    throw new Error('Missing required env var: AGENT_SERVER_URL');
  }

  const mockABase = process.env.E2E_MOCK_LLM_A_BASE_URL;
  const mockBBase = process.env.E2E_MOCK_LLM_B_BASE_URL;
  if (typeof mockABase !== 'string' || !mockABase.trim()) {
    throw new Error('Missing required env var: E2E_MOCK_LLM_A_BASE_URL');
  }
  if (typeof mockBBase !== 'string' || !mockBBase.trim()) {
    throw new Error('Missing required env var: E2E_MOCK_LLM_B_BASE_URL');
  }

  const stateFile = process.env.E2E_STATE_FILE;

  const markerPrefix = `e2e_remote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const markerFor = (index: number) => `${markerPrefix}_${index.toString().padStart(2, '0')}`;

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

  const profileA = `${markerPrefix}_profile_a`;
  const profileB = `${markerPrefix}_profile_b`;
  const modelA = `openai/${markerPrefix}_a`;
  const modelB = `openai/${markerPrefix}_b`;
  const baseUrlA = `${mockABase.replace(/\/+$/, '')}/v1`;
  const baseUrlB = `${mockBBase.replace(/\/+$/, '')}/v1`;
  const normalizeUrl = (value: unknown): string => typeof value === 'string' ? value.replace(/\/+$/, '') : '';

  const fetchConversationInfo = async (conversationId: string): Promise<ConversationInfoResponse> => {
    const base = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/conversations/${conversationId}`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET /api/conversations/${conversationId} failed: HTTP ${res.status}`);
    return await res.json() as ConversationInfoResponse;
  };

  const postConversationEvent = async (conversationId: string, text: string): Promise<void> => {
    const base = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/conversations/${conversationId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text }],
        run: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /api/conversations/${conversationId}/events failed: HTTP ${res.status} ${body}`);
    }
  };

  const fetchEventCount = async (conversationId: string): Promise<number> => {
    const base = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/conversations/${conversationId}/events/count`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET /api/conversations/${conversationId}/events/count failed: HTTP ${res.status}`);
    const raw = await res.text();
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid events/count response: ${raw}`);
    return n;
  };

  const fetchEventsFirstPage = async (conversationId: string): Promise<{ count: number; hasNextPage: boolean }> => {
    const base = serverUrl.replace(/\/+$/, '');
    const url = new URL(`${base}/api/conversations/${conversationId}/events/search`);
    url.searchParams.set('limit', '100');
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`GET /api/conversations/${conversationId}/events/search failed: HTTP ${res.status}`);
    const json = await res.json() as { items?: unknown; next_page_id?: unknown };
    const items = Array.isArray(json?.items) ? json.items : [];
    return { count: items.length, hasNextPage: typeof json?.next_page_id === 'string' && json.next_page_id.length > 0 };
  };

  const fetchMockRequestCount = async (base: string): Promise<number> => {
    const res = await fetch(`${base.replace(/\/+$/, '')}/__log`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET ${base}/__log failed: HTTP ${res.status}`);
    const data = await res.json() as { requests?: unknown };
    const requests = Array.isArray(data?.requests) ? data.requests : [];
    return requests.length;
  };

  try {
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: profileA,
      profile: { provider: 'openai', model: modelA, baseUrl: baseUrlA },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: profileB,
      profile: { provider: 'openai', model: modelB, baseUrl: baseUrlB },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: profileA });
  } catch (err) {
    throw new Error(`Failed to set up test LLM profiles: ${err instanceof Error ? err.message : String(err)}`);
  }

  await sleep(250);
  await vscode.commands.executeCommand('openhands.startNewConversation');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.status === 'online' && typeof diag?.conversationId === 'string';
  }, 45000);

  const diagStarted = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  const conversationId = typeof diagStarted?.conversationId === 'string' ? diagStarted.conversationId : '';
  if (!conversationId) throw new Error('Missing conversationId after startNewConversation');

  // Pre-populate a realistic number of events on the server without triggering LLM calls.
  // This exercises restore + pagination in the remote client (agent-sdk-ts / VS Code).
  const historyEventCount = 120;
  for (let i = 0; i < historyEventCount / 2; i += 1) {
    await postConversationEvent(conversationId, `E2E history pre-switch ${i}`);
  }

  if (typeof stateFile === 'string' && stateFile.trim()) {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        conversationId,
        profileA,
        profileB,
        modelA,
        modelB,
        baseUrlA,
        baseUrlB,
        historyEventCount,
      }, null, 2),
      'utf8'
    );
  }

  const matches = (info: ConversationInfoResponse, model: string, baseUrl: string): boolean => {
    return info.agent?.llm?.model === model && normalizeUrl(info.agent?.llm?.base_url) === normalizeUrl(baseUrl);
  };

  let lastA: ConversationInfoResponse | undefined;
  try {
    await pollUntil(async () => {
      lastA = await fetchConversationInfo(conversationId);
      return matches(lastA, modelA, baseUrlA);
    }, 20000);
  } catch (err) {
    const lastModel = lastA?.agent?.llm?.model;
    const lastBaseUrl = lastA?.agent?.llm?.base_url;
    throw new Error(
      `Timed out waiting for server to start on profileA. lastModel=${String(lastModel)} lastBaseUrl=${String(lastBaseUrl)} (${String(err)})`
    );
  }

  await vscode.commands.executeCommand('openhands._selectProfile', { profileId: profileB });
  let lastB: ConversationInfoResponse | undefined;
  try {
    await pollUntil(async () => {
      lastB = await fetchConversationInfo(conversationId);
      return matches(lastB, modelB, baseUrlB);
    }, 20000);
  } catch (err) {
    const lastModel = lastB?.agent?.llm?.model;
    const lastBaseUrl = lastB?.agent?.llm?.base_url;
    throw new Error(
      `Timed out waiting for server to switch to profileB. lastModel=${String(lastModel)} lastBaseUrl=${String(lastBaseUrl)} (${String(err)})`
    );
  }

  // Add more history after switching to ensure the conversation has a sizable log under both LLM configs.
  for (let i = 0; i < historyEventCount / 2; i += 1) {
    await postConversationEvent(conversationId, `E2E history post-switch ${i}`);
  }

  const serverCount = await fetchEventCount(conversationId);
  if (serverCount < historyEventCount) {
    throw new Error(`Expected server to have >=${historyEventCount} events, got ${serverCount}`);
  }
  const firstPage = await fetchEventsFirstPage(conversationId);
  if (firstPage.count !== 100 || !firstPage.hasNextPage) {
    throw new Error(`Expected first page to have 100 items and a next_page_id (got count=${firstPage.count}, hasNextPage=${firstPage.hasNextPage})`);
  }

  const mockBeforeB = await fetchMockRequestCount(mockBBase);

  const before = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  const beforeCount = typeof before?.count === 'number' ? before.count : 0;

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (agent-server remote smoke).' }
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

  await pollUntil(async () => (await fetchMockRequestCount(mockBBase)) > mockBeforeB, 10000, 200);

  const afterRemote = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  const baselineCount = typeof afterRemote?.count === 'number' ? afterRemote.count : 0;
  const baselineTypes = Array.isArray(afterRemote?.eventTypes)
    ? afterRemote.eventTypes.filter((t): t is string => typeof t === 'string')
    : [];
  console.log(
    `Remote rendered events (post-send): count=${baselineCount} types=${baselineTypes.slice(-10).join(', ')}`
  );
  if (!lastSnapshots.length) {
    const hint = baselineTypes.slice(-20).join(', ');
    throw new Error(`Expected remote response events to render, but snapshots were empty (types=${hint})`);
  }
  const newSnapshots = lastSnapshots.slice(beforeCount);
  const hasRemoteResponse = newSnapshots.some((event) =>
    event.type === 'ConversationErrorEvent' || (event.type === 'MessageEvent' && event.role === 'assistant')
  );
  if (!hasRemoteResponse) {
    const tail = newSnapshots.slice(-10).map((event) => `${event.type}:${event.role ?? ''}`).join(', ');
    throw new Error(`Expected remote response after sendMessage, but only saw: ${tail || '(none)'}`);
  }

  const diagBefore = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  const backlogBefore = typeof diagBefore?.eventBacklog?.size === 'number' ? diagBefore.eventBacklog.size : 0;

  const injectedEvents = [
    {
      kind: 'SystemPromptEvent',
      source: 'agent',
      e2e_marker: markerFor(1),
      system_prompt: { type: 'text', text: 'You are a helpful AI assistant' },
      tools: [{ name: 'terminal' }, { name: 'file_editor' }]
    },
    {
      kind: 'ActionEvent',
      source: 'agent',
      e2e_marker: markerFor(2),
      thought: [{ type: 'text', text: 'I need to check the current directory' }],
      reasoning_content: 'To understand the workspace structure',
      action: { command: 'pwd' },
      tool_name: 'terminal',
      tool_call_id: 'call_remote_001',
      tool_call: {
        id: 'call_remote_001',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"pwd"}' }
      },
      llm_response_id: 'resp_remote_001',
      security_risk: 'LOW'
    },
    {
      kind: 'ObservationEvent',
      source: 'environment',
      e2e_marker: markerFor(3),
      observation: { content: '/tmp', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_remote_001',
      action_id: 'action_remote_001'
    },
    {
      kind: 'UserRejectObservation',
      source: 'environment',
      e2e_marker: markerFor(4),
      rejection_reason: 'This command looks dangerous',
      tool_name: 'terminal',
      tool_call_id: 'call_remote_002',
      action_id: 'action_remote_002'
    },
    {
      kind: 'MessageEvent',
      source: 'user',
      e2e_marker: markerFor(5),
      llm_message: { role: 'user', content: [{ type: 'text', text: 'Please help me debug this code' }] }
    },
    {
      kind: 'MessageEvent',
      source: 'agent',
      e2e_marker: markerFor(6),
      llm_message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'I will help you debug the code. Let me analyze it first.' }],
        reasoning_content: 'Starting with the smallest repro'
      }
    },
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      e2e_marker: markerFor(7),
      error: 'Failed to execute command: permission denied',
      tool_name: 'terminal',
      tool_call_id: 'call_remote_004'
    },
    {
      kind: 'ConversationErrorEvent',
      source: 'environment',
      e2e_marker: markerFor(8),
      detail: 'Connection lost to server',
      code: 'ConnectionError'
    },
    {
      kind: 'PauseEvent',
      source: 'agent',
      e2e_marker: markerFor(9)
    },
    {
      kind: 'Condensation',
      source: 'environment',
      e2e_marker: markerFor(10),
      forgotten_event_ids: ['event_001', 'event_002'],
      summary: 'Condensed 2 events to save memory'
    },
    {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      e2e_marker: markerFor(11),
      agent_status: 'running'
    }
  ];

  const expectedRendered = injectedEvents
    .filter((event) => event.kind !== 'ConversationStateUpdateEvent')
    .map((event) => ({ type: event.kind, marker: event.e2e_marker }));
  const expectedPairs = expectedRendered.map((s) => `${s.type}:${s.marker}`);
  const filteredMarker = injectedEvents.find((event) => event.kind === 'ConversationStateUpdateEvent')?.e2e_marker;

  for (const event of injectedEvents) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event);
    await sleep(50);
  }

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    const size = typeof diag?.eventBacklog?.size === 'number' ? diag.eventBacklog.size : 0;
    return size >= backlogBefore + injectedEvents.length;
  }, 10000);

  let lastPairs: string[] = [];
  try {
    await pollUntil(async () => {
      const rendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
      const snapshots = Array.isArray(rendered?.events) ? rendered.events : null;
      if (!snapshots) {
        lastPairs = [];
        return false;
      }

      type RenderedSnapshot = { type: string; marker?: string };

      const pairs = snapshots
        .map((snapshot): RenderedSnapshot => {
          const record = snapshot as RenderedEventSnapshot;
          return {
            type: typeof record.type === 'string' ? record.type : 'unknown',
            marker: typeof record.marker === 'string' ? record.marker : undefined,
          };
        })
        .filter((snapshot): snapshot is RenderedSnapshot & { marker: string } => typeof snapshot.marker === 'string')
        .map((snapshot) => `${snapshot.type}:${snapshot.marker}`);
      lastPairs = pairs;

      const hasExpected = containsSubsequence(pairs, expectedPairs);
      const hasFiltered =
        typeof filteredMarker === 'string' ? pairs.some((pair) => pair.endsWith(`:${filteredMarker}`)) : false;
      return hasExpected && !hasFiltered;
    }, 20000);
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Timed out waiting for injected event markers to render. expectedPairs=${expectedPairs.join(', ')} filteredMarker=${filteredMarker ?? 'none'} lastPairs=${lastPairs.slice(-20).join(', ')} (original error: ${errorText})`
    );
  }

  const afterAll = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  console.log(
    `Remote rendered events (post-inject): count=${afterAll?.count} types=${Array.isArray(afterAll?.eventTypes) ? afterAll.eventTypes.slice(-20).join(', ') : ''}`
  );

  console.log('✓ Remote agent-server E2E test passed');
}
