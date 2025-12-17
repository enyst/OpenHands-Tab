import * as vscode from 'vscode';

const sleep = async (ms: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

async function pollUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 200
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sleep(intervalMs);
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

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

  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.chat?.hasView && diag?.chat?.webviewReady;
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
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.serverUrl === serverUrl;
  }, 15000);

  await vscode.commands.executeCommand('openhands.startNewConversation');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return diag?.mode === 'remote' && diag?.status === 'online' && typeof diag?.conversationId === 'string';
  }, 45000);

  const before: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  const beforeCount = typeof before?.count === 'number' ? before.count : 0;
  const beforeMessageCount = Array.isArray(before?.eventTypes)
    ? before.eventTypes.filter((t: unknown) => t === 'MessageEvent').length
    : 0;

  const send: any = await vscode.commands.executeCommand('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text: 'Hello from E2E (agent-server remote smoke).' }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  await pollUntil(async () => {
    const rendered: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const count = typeof rendered?.count === 'number' ? rendered.count : 0;
    const types = Array.isArray(rendered?.eventTypes) ? rendered.eventTypes : [];
    const messageCount = types.filter((t: unknown) => t === 'MessageEvent').length;
    return count > beforeCount && messageCount > beforeMessageCount;
  }, 60000);

  const afterRemote: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  const baselineCount = typeof afterRemote?.count === 'number' ? afterRemote.count : 0;
  const baselineTypes = Array.isArray(afterRemote?.eventTypes) ? afterRemote.eventTypes : [];
  console.log(
    `Remote rendered events (post-send): count=${baselineCount} types=${baselineTypes.slice(-10).join(', ')}`
  );

  const diagBefore: any = await vscode.commands.executeCommand('openhands._diagnostics');
  const backlogBefore = typeof diagBefore?.eventBacklog?.size === 'number' ? diagBefore.eventBacklog.size : 0;

  const injectedEvents = [
    {
      kind: 'SystemPromptEvent',
      source: 'agent',
      system_prompt: { type: 'text', text: 'You are a helpful AI assistant' },
      tools: [{ name: 'terminal' }, { name: 'file_editor' }]
    },
    {
      kind: 'ActionEvent',
      source: 'agent',
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
      observation: { content: '/tmp', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_remote_001',
      action_id: 'action_remote_001'
    },
    {
      kind: 'UserRejectObservation',
      source: 'environment',
      rejection_reason: 'This command looks dangerous',
      tool_name: 'terminal',
      tool_call_id: 'call_remote_002',
      action_id: 'action_remote_002'
    },
    {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: { role: 'user', content: [{ type: 'text', text: 'Please help me debug this code' }] }
    },
    {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'I will help you debug the code. Let me analyze it first.' }],
        reasoning_content: 'Starting with the smallest repro'
      }
    },
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Failed to execute command: permission denied',
      tool_name: 'terminal',
      tool_call_id: 'call_remote_004'
    },
    {
      kind: 'ConversationErrorEvent',
      source: 'environment',
      detail: 'Connection lost to server',
      code: 'ConnectionError'
    },
    {
      kind: 'PauseEvent',
      source: 'agent'
    },
    {
      kind: 'Condensation',
      source: 'environment',
      forgotten_event_ids: ['event_001', 'event_002'],
      summary: 'Condensed 2 events to save memory'
    },
    {
      kind: 'ConversationStateUpdateEvent',
      source: 'agent',
      agent_status: 'running'
    }
  ];

  const expectedRenderedTypes = [
    'SystemPromptEvent',
    'ActionEvent',
    'ObservationEvent',
    'UserRejectObservation',
    'MessageEvent',
    'MessageEvent',
    'AgentErrorEvent',
    'ConversationErrorEvent',
    'PauseEvent',
    'Condensation',
    // ConversationStateUpdateEvent is filtered out by the webview
  ];

  for (const event of injectedEvents) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event as any);
    await sleep(50);
  }

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    const size = typeof diag?.eventBacklog?.size === 'number' ? diag.eventBacklog.size : 0;
    return size >= backlogBefore + injectedEvents.length;
  }, 10000);

  await pollUntil(async () => {
    const rendered: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    const count = typeof rendered?.count === 'number' ? rendered.count : 0;
    const types = Array.isArray(rendered?.eventTypes) ? rendered.eventTypes : [];
    if (count < baselineCount + expectedRenderedTypes.length) return false;
    const tail = types.slice(Math.min(baselineCount, types.length));
    return containsSubsequence(tail, expectedRenderedTypes);
  }, 20000);

  const afterAll: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(
    `Remote rendered events (post-inject): count=${afterAll?.count} types=${Array.isArray(afterAll?.eventTypes) ? afterAll.eventTypes.slice(-20).join(', ') : ''}`
  );

  console.log('✓ Remote agent-server E2E test passed');
}
