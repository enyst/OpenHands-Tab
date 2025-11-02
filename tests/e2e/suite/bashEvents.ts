import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Enable bash events setting
  // Try workspace config first, fall back to global if no workspace
  const config = vscode.workspace.getConfiguration();
  const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  await config.update('openhands.bashEvents.enabled', true, target);

  // Ensure panel is created (this will also initialize bashEventsClient)
  await vscode.commands.executeCommand('openhands.openTab');

  // Wait until panel, webview, and bash events client are ready
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.hasPanel && diag?.webviewReady && diag?.bashEvents?.hasClient) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Verify diagnostics
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diag?.bashEvents?.enabled) {
    throw new Error('Bash events not enabled in diagnostics');
  }
  if (!diag?.bashEvents?.hasClient) {
    throw new Error('BashEventsClient not initialized');
  }

  // Wait a bit for initialization
  await new Promise((r) => setTimeout(r, 500));

  // Test bash event sequence: Command → Output → Exit
  const bashEvents = [
    // BashCommand
    {
      type: 'BashCommand',
      id: 'cmd-uuid-1',
      timestamp: '2025-01-26T12:00:00Z',
      command_id: 'session-uuid-1',
      order: 0,
      command: 'ls -la /tmp'
    },

    // BashOutput with stdout
    {
      type: 'BashOutput',
      id: 'out-uuid-1',
      timestamp: '2025-01-26T12:00:01Z',
      command_id: 'session-uuid-1',
      order: 1,
      exit_code: null,
      stdout: 'total 48\ndrwxrwxrwt 10 root root 4096 Jan 26 12:00 .\ndrwxr-xr-x 20 root root 4096 Jan 25 10:00 ..\n',
      stderr: null
    },

    // BashOutput with more stdout
    {
      type: 'BashOutput',
      id: 'out-uuid-2',
      timestamp: '2025-01-26T12:00:02Z',
      command_id: 'session-uuid-1',
      order: 2,
      exit_code: null,
      stdout: 'drwx------ 2 user user 4096 Jan 26 11:30 user-temp\n',
      stderr: null
    },

    // BashExit
    {
      type: 'BashExit',
      id: 'exit-uuid-1',
      timestamp: '2025-01-26T12:00:03Z',
      command_id: 'session-uuid-1',
      order: 3,
      exit_code: 0
    },

    // Second command with stderr
    {
      type: 'BashCommand',
      id: 'cmd-uuid-2',
      timestamp: '2025-01-26T12:00:04Z',
      command_id: 'session-uuid-2',
      order: 0,
      command: 'ls /nonexistent'
    },

    // BashOutput with stderr
    {
      type: 'BashOutput',
      id: 'out-uuid-3',
      timestamp: '2025-01-26T12:00:05Z',
      command_id: 'session-uuid-2',
      order: 1,
      exit_code: null,
      stdout: null,
      stderr: 'ls: cannot access \'/nonexistent\': No such file or directory\n'
    },

    // BashExit with error code
    {
      type: 'BashExit',
      id: 'exit-uuid-2',
      timestamp: '2025-01-26T12:00:06Z',
      command_id: 'session-uuid-2',
      order: 2,
      exit_code: 2
    }
  ];

  // Inject each bash event
  for (const event of bashEvents) {
    const result: any = await vscode.commands.executeCommand('openhands._injectBashEvent', event);
    if (!result?.injected) {
      throw new Error(`Failed to inject bash event: ${event.type}. Error: ${result?.error}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Wait for all events to be processed
  await new Promise((r) => setTimeout(r, 500));

  // Query received bash events
  const receivedEvents: any = await vscode.commands.executeCommand('openhands._queryBashEvents');

  // Verify all events were received
  const expectedEventTypes = [
    'BashCommand',
    'BashOutput',
    'BashOutput',
    'BashExit',
    'BashCommand',
    'BashOutput',
    'BashExit'
  ];

  if (receivedEvents.count !== expectedEventTypes.length) {
    throw new Error(
      `Expected ${expectedEventTypes.length} bash events, received ${receivedEvents.count}. ` +
      `Event types: ${JSON.stringify(receivedEvents.eventTypes)}`
    );
  }

  // Verify event types match expected sequence
  for (let i = 0; i < expectedEventTypes.length; i++) {
    if (receivedEvents.eventTypes[i] !== expectedEventTypes[i]) {
      throw new Error(
        `Expected event type '${expectedEventTypes[i]}' at index ${i}, ` +
        `got '${receivedEvents.eventTypes[i]}'`
      );
    }
  }

  // Verify client is still initialized
  const diagAfter: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diagAfter?.bashEvents?.hasClient) {
    throw new Error('BashEventsClient was lost after injecting events');
  }

  // Verify client status (should be offline since we didn't actually connect via WebSocket)
  if (diagAfter?.bashEvents?.clientStatus !== 'offline') {
    console.warn(`Warning: Expected client status 'offline', got '${diagAfter?.bashEvents?.clientStatus}'`);
  }

  // Terminal creation is optional in headless environments
  if (diagAfter?.bashEvents?.hasTerminal) {
    console.log('✓ Terminal created successfully');
  } else {
    console.log('⚠ Terminal not created (headless CI environment)');
  }

  console.log(`✓ All ${receivedEvents.count} bash events received and processed correctly`);
}
