import * as vscode from 'vscode';
import type { ConversationInstance } from '@openhands/agent-sdk-ts';

type TerminalLogPtyLike = { ensureNewline?: () => void };

export type CreateConfigurationChangeHandlerDeps = {
  ensureConversationAndConnection: () => Promise<void>;

  getConversation: () => ConversationInstance | undefined;
  setConversation: (conversation: ConversationInstance | undefined) => void;

  getConversationMode: () => 'local' | 'remote';

  getTerminal: () => vscode.Terminal | undefined;
  setTerminal: (terminal: vscode.Terminal | undefined) => void;

  getTerminalLogPty: () => TerminalLogPtyLike | undefined;
  setTerminalLogPty: (pty: TerminalLogPtyLike | undefined) => void;

  setConversationStoreRoot: (root: string | undefined) => void;
  setVerboseEventLogging: (value: boolean) => void;

  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
};

export function createConfigurationChangeHandler(deps: CreateConfigurationChangeHandlerDeps) {
  return async (e: vscode.ConfigurationChangeEvent) => {
    if (e.affectsConfiguration('openhands.serverUrl')) {
      try { deps.getConversation()?.removeAllListeners(); deps.getConversation()?.disconnect(); } catch { }
      // If switching away from local mode, dispose any lingering log terminal
      const cfg = vscode.workspace.getConfiguration();
      const nextUrl = cfg.get<string>('openhands.serverUrl');
      const nextMode: 'local' | 'remote' = nextUrl ? 'remote' : 'local';
      if (deps.getConversationMode() === 'local' && nextMode === 'remote') {
        try { deps.getTerminal()?.dispose(); } catch { }
        deps.setTerminal(undefined);
        deps.setTerminalLogPty(undefined);
      }
      deps.setConversation(undefined);
      await deps.ensureConversationAndConnection();
      return;
    }

    if (e.affectsConfiguration('openhands.conversation.storeRoot')) {
      try { deps.getConversation()?.removeAllListeners(); deps.getConversation()?.disconnect(); } catch { }
      deps.setConversation(undefined);
      deps.setConversationStoreRoot(undefined);
      await deps.ensureConversationAndConnection();
      return;
    }

    if (e.affectsConfiguration('openhands.terminal.renderProgress')) {
      // Recreate on next terminal event so it picks up updated rendering behavior.
      try { deps.getTerminalLogPty()?.ensureNewline?.(); } catch { }
      try { deps.getTerminal()?.dispose(); } catch { }
      deps.setTerminal(undefined);
      deps.setTerminalLogPty(undefined);
      return;
    }

    if (e.affectsConfiguration('openhands.agent.debug') || e.affectsConfiguration('openhands.devBridge.enabled')) {
      const cfg = vscode.workspace.getConfiguration();
      const debug = cfg.get<boolean>('openhands.agent.debug') ?? false;
      const devBridgeEnabled = cfg.get<boolean>('openhands.devBridge.enabled') ?? false;
      deps.setVerboseEventLogging(debug || devBridgeEnabled);
    }

    if (e.affectsConfiguration('openhands.llm')) {
      try {
        await deps.ensureConversationAndConnection();
        if (deps.getConversationMode() === 'remote') {
          deps.getOutputChannel()?.appendLine('[settings] LLM settings updated (remote mode: applies on next conversation)');
        } else {
          deps.getOutputChannel()?.appendLine('[settings] LLM settings updated (local mode: applies immediately)');
        }
      } catch (err: unknown) {
        deps.getOutputChannel()?.appendLine(`[settings] Failed to apply LLM settings update: ${deps.renderError(err)}`);
      }
    }
  };
}

