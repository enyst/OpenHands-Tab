const vscode = require('vscode');

async function run() {
  await vscode.commands.executeCommand('openhands.openTab');
  await new Promise((r) => setTimeout(r, 500));

  // Always safe commands
  await vscode.commands.executeCommand('openhands.reconnect');

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
