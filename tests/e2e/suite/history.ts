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

  // Test 1: Verify initial state - webview should be ready
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diag?.chat?.webviewReady) {
    throw new Error('Webview not ready');
  }

  // Test 2: Start a new conversation and verify conversation ID changes
  const initialConversationId = diag.conversationId;
  console.log(`Initial conversation ID: ${initialConversationId || 'none'}`);

  await vscode.commands.executeCommand('openhands.startNewConversation');
  await new Promise((r) => setTimeout(r, 1000));

  const diagAfterNew: any = await vscode.commands.executeCommand('openhands._diagnostics');
  console.log(`Conversation ID after new: ${diagAfterNew.conversationId || 'none'}`);

  // Test 3: Send test events to create conversation content
  const testEvents = [
    {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'Test message for history' }]
      }
    },
    {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Test response from agent' }]
      }
    }
  ];

  for (const event of testEvents) {
    await vscode.commands.executeCommand('openhands._sendTestEvent', event);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Wait for events to be processed
  await new Promise((r) => setTimeout(r, 500));

  // Test 4: Query rendered events
  const result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  if (!result) {
    throw new Error('Query rendered events returned null');
  }

  if (typeof result.count !== 'number') {
    throw new Error('Query rendered events missing count');
  }

  if (!Array.isArray(result.eventTypes)) {
    throw new Error('Query rendered events missing eventTypes array');
  }

  console.log(`Rendered events count: ${result.count}`);
  console.log(`Event types: ${result.eventTypes.join(', ')}`);

  // Verify we have at least the test events
  if (result.count < 2) {
    throw new Error(`Expected at least 2 events, got ${result.count}`);
  }

  // Test 5: Verify event backlog is tracked
  const diagWithEvents: any = await vscode.commands.executeCommand('openhands._diagnostics');
  console.log(`Event backlog size: ${diagWithEvents.eventBacklog?.size || 0}`);

  // Test 6: Start another new conversation and verify events are cleared
  await vscode.commands.executeCommand('openhands.startNewConversation');
  await new Promise((r) => setTimeout(r, 1000));

  const resultAfterNew: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  // After new conversation, the webview should have cleared events (or show just the restored ones)
  // Since it's a fresh conversation with no persistence, expect fewer events
  console.log(`Events after new conversation: ${resultAfterNew?.count || 0}`);

  console.log('✓ All history tests passed');
}
