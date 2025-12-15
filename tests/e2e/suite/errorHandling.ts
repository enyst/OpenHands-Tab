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

  // Test 1: Send AgentErrorEvent
  const agentError = {
    kind: 'AgentErrorEvent',
    source: 'agent',
    error: 'Failed to execute tool: API rate limit exceeded',
    tool_name: 'terminal',
    tool_call_id: 'call_error_001'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', agentError);
  await new Promise((r) => setTimeout(r, 300));

  let result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After agent error - Count: ${result.count}, Types: ${result.eventTypes.join(', ')}`);

  let errorCount = result.eventTypes.filter((t: string) => t === 'AgentErrorEvent').length;
  if (errorCount !== 1) {
    throw new Error(`Expected 1 AgentErrorEvent, got ${errorCount}`);
  }

  // Test 2: Send ConversationErrorEvent
  const conversationError = {
    kind: 'ConversationErrorEvent',
    source: 'agent',
    error: 'Connection lost to server',
    error_type: 'ConnectionError'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', conversationError);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After conversation error - Count: ${result.count}`);

  const convErrorCount = result.eventTypes.filter((t: string) => t === 'ConversationErrorEvent').length;
  if (convErrorCount !== 1) {
    throw new Error(`Expected 1 ConversationErrorEvent, got ${convErrorCount}`);
  }

  // Test 3: Send multiple error events in sequence
  const multipleErrors = [
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Permission denied: /etc/passwd',
      tool_name: 'file_editor',
      tool_call_id: 'call_error_002'
    },
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Timeout: operation took too long',
      tool_name: 'browser',
      tool_call_id: 'call_error_003'
    },
    {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Invalid JSON response from LLM',
      tool_name: 'llm',
      tool_call_id: 'call_error_004'
    }
  ];

  for (const err of multipleErrors) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', err);
    await new Promise((r) => setTimeout(r, 100));
  }

  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After multiple errors - Count: ${result.count}`);

  errorCount = result.eventTypes.filter((t: string) => t === 'AgentErrorEvent').length;
  if (errorCount !== 4) {
    throw new Error(`Expected 4 AgentErrorEvents total, got ${errorCount}`);
  }

  // Test 4: Send observation with non-zero exit code (error state)
  const failedObservation = {
    kind: 'ObservationEvent',
    source: 'environment',
    observation: {
      content: 'bash: command not found: nonexistent_command',
      exit_code: 127
    },
    tool_name: 'terminal',
    tool_call_id: 'call_failed',
    action_id: 'action_failed'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', failedObservation);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After failed observation - Count: ${result.count}`);

  const obsCount = result.eventTypes.filter((t: string) => t === 'ObservationEvent').length;
  if (obsCount !== 1) {
    throw new Error(`Expected 1 ObservationEvent, got ${obsCount}`);
  }

  // Test 5: Send PauseEvent (indicates interrupted state)
  const pauseEvent = {
    kind: 'PauseEvent',
    source: 'user'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', pauseEvent);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After pause event - Count: ${result.count}`);

  // PauseEvent is not rendered but should not cause errors
  const pauseCount = result.eventTypes.filter((t: string) => t === 'PauseEvent').length;
  // PauseEvent may or may not render (it shows in status bar)
  console.log(`PauseEvent count (may be 0 if not rendered): ${pauseCount}`);

  // Test 6: Send Condensation event (memory compaction)
  const condensation = {
    kind: 'Condensation',
    source: 'agent',
    forgotten_event_ids: ['evt_1', 'evt_2', 'evt_3'],
    summary: 'Condensed 3 events from earlier conversation'
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', condensation);
  await new Promise((r) => setTimeout(r, 300));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After condensation - Count: ${result.count}`);

  const condensationCount = result.eventTypes.filter((t: string) => t === 'Condensation').length;
  if (condensationCount !== 1) {
    throw new Error(`Expected 1 Condensation event, got ${condensationCount}`);
  }

  // Test 7: Verify diagnostics show proper state
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');

  if (!diag.chat.webviewReady) {
    throw new Error('Webview should still be ready after error events');
  }

  console.log(`Diagnostics - eventBacklog size: ${diag.eventBacklog.size}`);

  // Test 8: Recovery - start new conversation after errors
  await vscode.commands.executeCommand('openhands.startNewConversation');
  await new Promise((r) => setTimeout(r, 500));

  result = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`After new conversation - Events should be cleared or minimal: ${result.count}`);

  // After new conversation, events should be reset
  // (either 0 or any restored events from previous persistence)

  console.log('✓ All error handling tests passed');
}
