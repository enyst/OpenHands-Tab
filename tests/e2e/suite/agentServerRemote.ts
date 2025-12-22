import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

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

type RenderedEventSnapshot = {
  type?: unknown;
  marker?: unknown;
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

  const markerPrefix = `e2e_remote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const markerFor = (index: number) => `${markerPrefix}_${index.toString().padStart(2, '0')}`;

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  await vscode.workspace.getConfiguration().update(
    'openhands.serverUrl',
    serverUrl,
    vscode.ConfigurationTarget.Global
  );
  await vscode.workspace.getConfiguration().update(
    'openhands.conversation.maxIterations',
    1,
    vscode.ConfigurationTarget.Global
  );

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
  const beforeTypes = Array.isArray(before?.eventTypes)
    ? before.eventTypes.filter((t): t is string => typeof t === 'string')
    : [];
  const beforeMessageCount = beforeTypes.filter((t) => t === 'MessageEvent').length;

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (agent-server remote smoke).' }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  await pollUntil(async () => {
    const rendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
    const count = typeof rendered?.count === 'number' ? rendered.count : 0;
    const types = Array.isArray(rendered?.eventTypes)
      ? rendered.eventTypes.filter((t): t is string => typeof t === 'string')
      : [];
    const messageCount = types.filter((t) => t === 'MessageEvent').length;
    return count > beforeCount && messageCount > beforeMessageCount;
  }, 60000);

  const afterRemote = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
  const baselineCount = typeof afterRemote?.count === 'number' ? afterRemote.count : 0;
  const baselineTypes = Array.isArray(afterRemote?.eventTypes)
    ? afterRemote.eventTypes.filter((t): t is string => typeof t === 'string')
    : [];
  console.log(
    `Remote rendered events (post-send): count=${baselineCount} types=${baselineTypes.slice(-10).join(', ')}`
  );

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
