import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Ensure chat view is created
  await vscode.commands.executeCommand('openhands.open');

  // Wait until view and webview are ready
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.chat?.hasView && diag?.chat?.webviewReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Start fresh conversation
  await vscode.commands.executeCommand('openhands.startNewConversation');
  await new Promise((r) => setTimeout(r, 500));

  // Test 1: Send action events with different security risk levels
  const actionEventsWithRisks = [
    // LOW risk action
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'Reading a file is safe' }],
      action: { command: 'cat README.md' },
      tool_name: 'terminal',
      tool_call_id: 'call_low_risk',
      tool_call: {
        id: 'call_low_risk',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"cat README.md"}' }
      },
      llm_response_id: 'resp_low',
      security_risk: 'LOW'
    },
    // MEDIUM risk action
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'Installing a package' }],
      action: { command: 'npm install express' },
      tool_name: 'terminal',
      tool_call_id: 'call_medium_risk',
      tool_call: {
        id: 'call_medium_risk',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"npm install express"}' }
      },
      llm_response_id: 'resp_medium',
      security_risk: 'MEDIUM'
    },
    // HIGH risk action
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'This is a dangerous command' }],
      action: { command: 'rm -rf /tmp/test' },
      tool_name: 'terminal',
      tool_call_id: 'call_high_risk',
      tool_call: {
        id: 'call_high_risk',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test"}' }
      },
      llm_response_id: 'resp_high',
      security_risk: 'HIGH'
    },
    // UNKNOWN risk action (no security_risk field)
    {
      kind: 'ActionEvent',
      source: 'agent',
      thought: [{ type: 'text', text: 'Unknown risk command' }],
      action: { command: 'echo hello' },
      tool_name: 'terminal',
      tool_call_id: 'call_unknown_risk',
      tool_call: {
        id: 'call_unknown_risk',
        type: 'function',
        function: { name: 'terminal', arguments: '{"command":"echo hello"}' }
      },
      llm_response_id: 'resp_unknown'
      // No security_risk field
    }
  ];

  for (const event of actionEventsWithRisks) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event);
    await new Promise((r) => setTimeout(r, 100));
  }

  await new Promise((r) => setTimeout(r, 500));

  // Query rendered events
  let result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  console.log(`After actions - Count: ${result.count}, Types: ${result.eventTypes.join(', ')}`);

  // Verify all action events rendered
  const actionCount = result.eventTypes.filter((t: string) => t === 'ActionEvent').length;
  if (actionCount !== 4) {
    throw new Error(`Expected 4 ActionEvents with different risk levels, got ${actionCount}`);
  }

  // Test 2: Send observation events to complete the actions
  const observations = [
    {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { content: 'README content here', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_low_risk',
      action_id: 'action_low'
    },
    {
      kind: 'ObservationEvent',
      source: 'environment',
      observation: { content: 'added 50 packages', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_medium_risk',
      action_id: 'action_medium'
    }
  ];

  for (const obs of observations) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', obs);
    await new Promise((r) => setTimeout(r, 100));
  }

  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After observations - Count: ${result.count}`);

  // Test 3: Send user rejection observation
  const rejection = {
    kind: 'UserRejectObservation',
    source: 'user',
    rejection_reason: 'This command is too dangerous',
    tool_name: 'terminal',
    tool_call_id: 'call_high_risk',
    action_id: 'action_high'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', rejection);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After rejection - Count: ${result.count}`);

  const rejectCount = result.eventTypes.filter((t: string) => t === 'UserRejectObservation').length;
  if (rejectCount !== 1) {
    throw new Error(`Expected 1 UserRejectObservation, got ${rejectCount}`);
  }

  // Test 4: Send ConversationStateUpdateEvent with confirmation status
  const confirmationStateEvent = {
    kind: 'ConversationStateUpdateEvent',
    source: 'agent',
    agent_status: 'WAITING_FOR_CONFIRMATION'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', confirmationStateEvent);
  await new Promise((r) => setTimeout(r, 300));

  // ConversationStateUpdateEvent should be filtered from rendering
  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  const stateUpdateCount = result.eventTypes.filter((t: string) => t === 'ConversationStateUpdateEvent').length;

  if (stateUpdateCount > 0) {
    throw new Error('ConversationStateUpdateEvent should be filtered from rendering');
  }

  console.log('✓ ConversationStateUpdateEvent correctly filtered');

  // Test 5: Action without execution (action is null)
  const unexecutedAction = {
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'This action was not executed' }],
    action: null,
    tool_name: 'file_editor',
    tool_call_id: 'call_unexecuted',
    tool_call: {
      id: 'call_unexecuted',
      type: 'function',
      function: { name: 'file_editor', arguments: '{"path":"test.txt"}' }
    },
    llm_response_id: 'resp_unexecuted'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', unexecutedAction);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After unexecuted action - Count: ${result.count}`);

  // Total should include all action types
  const totalActions = result.eventTypes.filter((t: string) => t === 'ActionEvent').length;
  if (totalActions !== 5) {
    throw new Error(`Expected 5 total ActionEvents, got ${totalActions}`);
  }

  console.log('✓ All confirmation tests passed');
}
