const vscode = require('vscode');

async function run() {
  await vscode.commands.executeCommand('openhands.openTab');
  // Wait until panel is reported via diagnostics to avoid flakiness
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag && diag.hasPanel) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Always safe commands
  await vscode.commands.executeCommand('openhands.reconnect');

  // Query diagnostics and log for CI visibility
  const diag = await vscode.commands.executeCommand('openhands._diagnostics');
  console.log('DIAG', JSON.stringify(diag));

  // Optional deeper path if a server is available in the environment
  if (process.env.E2E_WITH_SERVER === '1') {
    try {
      await vscode.commands.executeCommand('openhands.startNewConversation');
      await new Promise((r) => setTimeout(r, 1000));
      await vscode.commands.executeCommand('openhands.pauseCurrentRun');
    } catch (e) {
      // Do not fail the smoke if server is not reachable
      console.warn('Optional server-backed steps failed (ignored):', e);
    }
  }
}

module.exports = { run };
