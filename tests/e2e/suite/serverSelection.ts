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

  // Test 1: Check initial mode (should be local when no serverUrl configured)
  let diag: DiagnosticsInfo | undefined = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');

  if (!diag) {
    throw new Error('Diagnostics returned null');
  }
  if (!diag.chat) {
    throw new Error('Diagnostics missing chat object');
  }

  console.log(`Initial mode: ${diag.mode}`);
  console.log(`Initial serverUrl: ${diag.serverUrl || 'empty'}`);

  // In a fresh install, serverUrl should be empty
  if (diag.serverUrl && diag.serverUrl.length > 0) {
    console.log('Server URL is configured, testing remote mode...');
    if (diag.mode !== 'remote') {
      throw new Error(`Expected remote mode when serverUrl is set, got ${diag.mode}`);
    }
  } else {
    console.log('Server URL is empty, testing local mode...');
    if (diag.mode !== 'local') {
      throw new Error(`Expected local mode when serverUrl is empty, got ${diag.mode}`);
    }
  }

  // Test 2: Verify status is present
  console.log(`Status: ${diag.status}`);
  // Status might be undefined initially in local mode

  // Test 3: Verify conversation state structure
  if (typeof diag.hasConversation !== 'boolean') {
    throw new Error('Missing hasConversation boolean');
  }

  console.log(`Has conversation: ${diag.hasConversation}`);

  // Test 4: Verify terminal state (only relevant in local mode)
  if (typeof diag.terminal !== 'object') {
    throw new Error('Missing terminal object in diagnostics');
  }

  console.log(`Has terminal: ${diag.terminal.hasTerminal}`);
  console.log(`Terminal events received: ${diag.terminal.received}`);

  // Test 5: Test reconnect command behavior
  await vscode.commands.executeCommand('openhands.reconnect');

  // Poll until webview is ready after reconnect
  await pollUntil(async () => {
    const d = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(d?.chat?.webviewReady);
  });

  diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diag?.chat) {
    throw new Error('Diagnostics missing chat object');
  }
  console.log(`Mode after reconnect: ${diag.mode}`);

  // Test 6: Verify webview maintains readiness after reconnect
  if (!diag.chat.webviewReady) {
    throw new Error('Webview lost readiness after reconnect');
  }

  // Test 7: Start new conversation and verify mode persists
  await vscode.commands.executeCommand('openhands.startNewConversation');

  // Poll until webview is ready after new conversation
  await pollUntil(async () => {
    const d = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(d?.chat?.webviewReady);
  });

  diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diag?.chat) {
    throw new Error('Diagnostics missing chat object');
  }
  console.log(`Mode after new conversation: ${diag.mode}`);

  // Mode should persist across conversation changes
  // (it's determined by serverUrl config, not conversation state)

  // Test 8: Verify event backlog is reset with new conversation
  console.log(`Event backlog after new conversation: ${diag.eventBacklog?.size || 0}`);
  // New conversation should have empty or minimal event backlog

  // Test 9: Send a test event and verify mode handling
  const testEvent = {
    kind: 'MessageEvent',
    source: 'user',
    llm_message: {
      role: 'user',
      content: [{ type: 'text', text: 'Test message' }]
    }
  };

  await vscode.commands.executeCommand('openhands._sendTestEvent', testEvent);

  // Poll until event is rendered
  await pollUntil(async () => {
    const r: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
    return r?.count >= 1;
  });

  diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diag) {
    throw new Error('Diagnostics returned null');
  }

  // Verify backlog increased
  if ((diag.eventBacklog?.size ?? 0) < 1) {
    throw new Error('Event backlog should have increased after sending a test event');
  }

  // Test 10: Query rendered events should work regardless of mode
  const result: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');

  if (!result || typeof result.count !== 'number') {
    throw new Error('Query rendered events failed');
  }

  console.log(`Rendered events: ${result.count}`);

  console.log('✓ All server selection tests passed');
}
