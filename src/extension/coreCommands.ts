import * as vscode from 'vscode';
import { normalizeOutputVerbosity, type OutputLogger, type OutputVerbosity } from './outputLogger';

type CoreCommandDeps = {
  ensureConversationAndConnection: () => Promise<void>;
  focusOpenHandsView: () => Promise<void>;
  startNewConversation: () => Promise<void>;
  reconnectConversation: () => Promise<void>;
  pauseConversation: () => Promise<void>;
  resumeConversation: () => Promise<void>;
  setOutputVerbosity: (verbosity: OutputVerbosity) => void;
  setVerboseEventLogging: (verbose: boolean) => void;
  getOutputLogger: () => OutputLogger | undefined;
};

export function registerCoreCommands({
  ensureConversationAndConnection,
  focusOpenHandsView,
  startNewConversation,
  reconnectConversation,
  pauseConversation,
  resumeConversation,
  setOutputVerbosity,
  setVerboseEventLogging,
  getOutputLogger,
}: CoreCommandDeps): vscode.Disposable[] {
  const open = vscode.commands.registerCommand('openhands.open', async () => {
    await focusOpenHandsView();
    await ensureConversationAndConnection();
  });

  const startNew = vscode.commands.registerCommand('openhands.startNewConversation', async () => {
    await startNewConversation();
  });

  const configure = vscode.commands.registerCommand('openhands.configure', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
  });

  const toggleVerboseOutput = vscode.commands.registerCommand('openhands.toggleVerboseOutput', async () => {
    const cfg = vscode.workspace.getConfiguration();
    const current = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
    const next: OutputVerbosity = current === 'verbose' ? 'minimal' : 'verbose';
    await cfg.update('openhands.logging.verbosity', next, vscode.ConfigurationTarget.Global);

    setOutputVerbosity(next);
    setVerboseEventLogging(
      next === 'verbose' ||
        Boolean(cfg.get<boolean>('openhands.agent.debug')) ||
        Boolean(cfg.get<boolean>('openhands.devBridge.enabled'))
    );

    const outputLogger = getOutputLogger();
    outputLogger?.info(`[settings] Output verbosity set to ${next}`);
    if (next === 'verbose') {
      outputLogger?.show(true);
    }

    void vscode.window.showInformationMessage(`OpenHands output verbosity: ${next}`);
  });

  const reconnect = vscode.commands.registerCommand('openhands.reconnect', async () => {
    await reconnectConversation();
  });

  const pause = vscode.commands.registerCommand('openhands.pauseCurrentRun', async () => {
    await pauseConversation();
  });

  const resume = vscode.commands.registerCommand('openhands.resumeCurrentRun', async () => {
    await resumeConversation();
  });

  return [open, startNew, configure, toggleVerboseOutput, reconnect, pause, resume];
}
