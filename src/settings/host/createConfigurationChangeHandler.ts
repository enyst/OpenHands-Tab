import * as vscode from 'vscode';
import type { ConversationInstance } from '@smolpaws/agent-sdk';
import { normalizeOutputVerbosity, type OutputVerbosity } from '../../extension/outputLogger';

type TerminalLogPtyLike = { ensureNewline?: () => void };

type EnsureConversationOptions = {
  uiJustCreated?: boolean;
  modeSwitched?: boolean;
};

export type CreateConfigurationChangeHandlerDeps = {
  ensureConversationAndConnection: (options?: EnsureConversationOptions) => Promise<void>;

  getConversation: () => ConversationInstance | undefined;
  setConversation: (conversation: ConversationInstance | undefined) => void;

  getConversationMode: () => 'local' | 'remote';

  getTerminal: () => vscode.Terminal | undefined;
  setTerminal: (terminal: vscode.Terminal | undefined) => void;

  getTerminalLogPty: () => TerminalLogPtyLike | undefined;
  setTerminalLogPty: (pty: TerminalLogPtyLike | undefined) => void;

  setConversationStoreRoot: (root: string | undefined) => void;
  setOutputVerbosity: (value: OutputVerbosity) => void;
  setVerboseEventLogging: (value: boolean) => void;

  log: {
    info: (line: string) => void;
    warn: (line: string) => void;
    error: (line: string) => void;
  };
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
      await deps.ensureConversationAndConnection({ modeSwitched: true });
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

    if (
      e.affectsConfiguration('openhands.agent.debug') ||
      e.affectsConfiguration('openhands.devBridge.enabled') ||
      e.affectsConfiguration('openhands.logging.verbosity')
    ) {
      const cfg = vscode.workspace.getConfiguration();
      const debug = cfg.get<boolean>('openhands.agent.debug') ?? false;
      const devBridgeEnabled = cfg.get<boolean>('openhands.devBridge.enabled') ?? false;
      const verbosity = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
      deps.setOutputVerbosity(verbosity);
      deps.setVerboseEventLogging(debug || devBridgeEnabled || verbosity === 'verbose');
    }

    if (e.affectsConfiguration('openhands.agent.summarizeToolCalls')) {
      try {
        await deps.ensureConversationAndConnection();
        deps.log.info('[settings] Tool-call summarization setting updated');
      } catch (err: unknown) {
        deps.log.warn(`[settings] Failed to apply tool-call summarization update: ${deps.renderError(err)}`);
      }
    }

    if (e.affectsConfiguration('openhands.llm')) {
      try {
        await deps.ensureConversationAndConnection();
        if (deps.getConversationMode() === 'remote') {
          deps.log.info('[settings] LLM settings updated (remote mode: applies on next conversation)');
        } else {
          deps.log.info('[settings] LLM settings updated (local mode: applies immediately)');
        }
      } catch (err: unknown) {
        deps.log.warn(`[settings] Failed to apply LLM settings update: ${deps.renderError(err)}`);
      }
    }

    if (e.affectsConfiguration('openhands.confirmation')) {
      try {
        await deps.ensureConversationAndConnection();
        if (deps.getConversationMode() === 'remote') {
          deps.log.info('[settings] Confirmation settings updated (remote mode: applies on next conversation)');
        } else {
          deps.log.info('[settings] Confirmation settings updated (local mode: applies immediately)');
        }
      } catch (err: unknown) {
        deps.log.warn(`[settings] Failed to apply confirmation settings update: ${deps.renderError(err)}`);
      }
    }

    if (e.affectsConfiguration('openhands.conversation.maxIterations')) {
      try {
        await deps.ensureConversationAndConnection();
        if (deps.getConversationMode() === 'remote') {
          deps.log.info('[settings] Max iterations setting updated (remote mode: applies on next conversation)');
        } else {
          deps.log.info('[settings] Max iterations setting updated (local mode: applies on next run)');
        }
      } catch (err: unknown) {
        deps.log.warn(`[settings] Failed to apply max iterations update: ${deps.renderError(err)}`);
      }
    }
  };
}
