import * as vscode from 'vscode';

async function pollUntil(
  condition: () => Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 200
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
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

  const after: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
  console.log(`Remote rendered events: count=${after?.count} types=${Array.isArray(after?.eventTypes) ? after.eventTypes.slice(-10).join(', ') : ''}`);

  console.log('✓ Remote agent-server E2E test passed');
}
