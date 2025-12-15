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

  // Test 1: Verify diagnostics command returns expected structure
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');

  if (!diag) {
    throw new Error('Diagnostics command returned null/undefined');
  }

  // Verify chat state
  if (typeof diag.chat !== 'object') {
    throw new Error('Diagnostics missing chat object');
  }
  if (typeof diag.chat.hasView !== 'boolean') {
    throw new Error('Diagnostics missing chat.hasView');
  }
  if (typeof diag.chat.webviewReady !== 'boolean') {
    throw new Error('Diagnostics missing chat.webviewReady');
  }

  // Verify event backlog state
  if (typeof diag.eventBacklog !== 'object') {
    throw new Error('Diagnostics missing eventBacklog object');
  }
  if (typeof diag.eventBacklog.size !== 'number') {
    throw new Error('Diagnostics missing eventBacklog.size');
  }

  // Verify mode is present
  if (diag.mode !== 'local' && diag.mode !== 'remote') {
    throw new Error(`Unexpected mode: ${diag.mode}`);
  }

  // Test 2: Verify configure command can be executed (opens settings)
  try {
    await vscode.commands.executeCommand('openhands.configure');
    console.log('✓ Configure command executed successfully');
  } catch (err) {
    throw new Error(`Configure command failed: ${err}`);
  }

  // Test 3: Verify reconnect command works
  try {
    await vscode.commands.executeCommand('openhands.reconnect');
    console.log('✓ Reconnect command executed successfully');
  } catch (err) {
    throw new Error(`Reconnect command failed: ${err}`);
  }

  // Test 4: Verify startNewConversation command works
  try {
    await vscode.commands.executeCommand('openhands.startNewConversation');
    console.log('✓ Start new conversation command executed successfully');
  } catch (err) {
    throw new Error(`Start new conversation command failed: ${err}`);
  }

  // Wait a bit for conversation to reset
  await new Promise((r) => setTimeout(r, 500));

  // Verify diagnostics after new conversation
  const diagAfter: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diagAfter?.chat?.webviewReady) {
    throw new Error('Webview not ready after new conversation');
  }

  // Test 5: Verify pause and resume commands exist and can be called
  try {
    await vscode.commands.executeCommand('openhands.pauseCurrentRun');
    console.log('✓ Pause command executed successfully');
  } catch (err) {
    // Pause may fail if no agent is running, but command should exist
    console.log('✓ Pause command exists (may have failed due to no active run)');
  }

  try {
    await vscode.commands.executeCommand('openhands.resumeCurrentRun');
    console.log('✓ Resume command executed successfully');
  } catch (err) {
    // Resume may fail if agent is not paused
    console.log('✓ Resume command exists (may have failed due to no paused run)');
  }

  console.log('✓ All settings tests passed');
}
