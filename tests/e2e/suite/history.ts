import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

export async function run(): Promise<void> {
  // Ensure chat view is created
  await vscode.commands.executeCommand('openhands.open');

  // Wait until view and webview are ready
  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  // Test 1: Verify initial state - webview should be ready
  const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diag) {
    throw new Error('Diagnostics command returned null/undefined');
  }
  if (!diag?.chat?.webviewReady) {
    throw new Error('Webview not ready');
  }

  // Test 2: Start a new conversation and verify conversation ID changes
  const initialConversationId = diag.conversationId;
  console.log(`Initial conversation ID: ${initialConversationId || 'none'}`);

  await vscode.commands.executeCommand('openhands.startNewConversation');

  // Poll until webview is ready after new conversation
  await pollUntil(async () => {
    const d = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(d?.chat?.webviewReady);
  });

  const diagAfterNew = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diagAfterNew) {
    throw new Error('Diagnostics command returned null/undefined');
  }
  console.log(`Conversation ID after new: ${diagAfterNew.conversationId || 'none'}`);
  if (initialConversationId && diagAfterNew.conversationId && diagAfterNew.conversationId === initialConversationId) {
    throw new Error(`Expected conversationId to change after startNewConversation (still ${diagAfterNew.conversationId})`);
  }

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
  }

  // Poll until events are rendered
  await pollUntil(async () => {
    const result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    return result?.count >= testEvents.length;
  });

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
  if (result.count < testEvents.length) {
    throw new Error(`Expected at least ${testEvents.length} events, got ${result.count}`);
  }

  // Test 5: Verify event backlog is tracked
  const diagWithEvents = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diagWithEvents) {
    throw new Error('Diagnostics command returned null/undefined');
  }
  console.log(`Event backlog size: ${diagWithEvents.eventBacklog?.size || 0}`);
  const backlogWithEvents = diagWithEvents.eventBacklog?.size ?? 0;
  if (backlogWithEvents < testEvents.length) {
    throw new Error(`Expected eventBacklog.size >= ${testEvents.length}, got ${backlogWithEvents}`);
  }

  // Test 6: Start another new conversation and verify events are cleared
  await vscode.commands.executeCommand('openhands.startNewConversation');

  // Poll until webview is ready
  await pollUntil(async () => {
    const d = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(d?.chat?.webviewReady);
  });

  const diagAfterReset = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diagAfterReset) {
    throw new Error('Diagnostics command returned null/undefined');
  }
  const backlogAfterReset = diagAfterReset.eventBacklog?.size ?? 0;
  if (backlogAfterReset >= backlogWithEvents) {
    throw new Error(`Expected eventBacklog.size to reset after new conversation (before=${backlogWithEvents}, after=${backlogAfterReset})`);
  }

  const resultAfterNew: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  // After new conversation, the webview should have cleared events (or show just the restored ones)
  // Since it's a fresh conversation with no persistence, expect fewer events
  console.log(`Events after new conversation: ${resultAfterNew?.count || 0}`);

  console.log('✓ All history tests passed');
}
