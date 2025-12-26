import * as vscode from 'vscode';
import * as path from 'path';
import type { BashEvent, ConversationInstance, Event } from '@openhands/agent-sdk-ts';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../shared/llmStreaming';
import type { HostToWebviewMessage } from '../../shared/webviewMessages';

export type AttachConversationListenersDeps = {
  context: vscode.ExtensionContext;
  conversation: ConversationInstance;

  getOutputChannel: () => vscode.OutputChannel | undefined;
  getChatView: () => vscode.WebviewView | undefined;
  isChatWebviewReady: () => boolean;
  getConversationMode: () => 'local' | 'remote';
  getLastKnownLlmLabel: () => string | null;
  isVerboseEventLogging: () => boolean;
  transformEventForWebview?: (event: Event, webview: vscode.Webview) => Event;

  bufferConversationEvent: (event: Event) => number;
  resetConversationEventBacklog: (conversationId: string | undefined) => void;
  trackAgentEditedFile?: (filePath: string) => void;
  resetAgentEditedFiles?: () => void;
  safeStringify: (value: unknown) => string;
  renderError: (err: unknown) => string;
  handleTerminalEvent: (event: BashEvent) => void;
};

function postToChatIfVisible(
  deps: Pick<AttachConversationListenersDeps, 'getChatView' | 'isChatWebviewReady'>,
  message: HostToWebviewMessage
) {
  const view = deps.getChatView();
  if (!view || !deps.isChatWebviewReady() || !view.visible) return;
  void view.webview.postMessage(message);
}

export function attachConversationListeners(deps: AttachConversationListenersDeps) {
  const { conversation } = deps;

  conversation.on('status', (s: string) => {
    const outputChannel = deps.getOutputChannel();
    outputChannel?.appendLine(`[status] ${s}`);
    postToChatIfVisible(deps, {
      type: 'status',
      status: s,
      mode: deps.getConversationMode(),
      llmProfileLabel: deps.getLastKnownLlmLabel(),
    });
  });

  let streamingState = initialLlmStreamingState;
  conversation.on('event', (ev: Event) => {
    const outputChannel = deps.getOutputChannel();

    const streamingUpdate = reduceLlmStreamingState(streamingState, ev);
    streamingState = streamingUpdate.state;
    const isStateUpdate = ev.kind === 'ConversationStateUpdateEvent';
    const isLlmStreamUpdate = isStateUpdate && (ev.key === 'llm_stream' || ev.key === 'llm_tool_call');

    if (streamingUpdate.started) {
      outputChannel?.appendLine('[llm] Streaming started...');
    }

    if (ev.kind === 'ConversationStateUpdateEvent' && (ev.key === 'llm_request_payload' || ev.key === 'llm_response_payload')) {
      const key = ev.key ?? 'llm_payload';
      const shouldLogToDebugConsole = deps.context.extensionMode !== vscode.ExtensionMode.Production;
      const shouldLogToOutputChannel = shouldLogToDebugConsole || deps.isVerboseEventLogging();

      if (shouldLogToOutputChannel) {
        const outputChannel = deps.getOutputChannel();
        try {
          outputChannel?.appendLine(`[llm][${key}]`);
          outputChannel?.appendLine(deps.safeStringify(ev.value));
        } catch (e) {
          outputChannel?.appendLine(`[llm][${key}] <failed to stringify: ${String(e)}>`);
        }
      }

      if (shouldLogToDebugConsole) {
        try {
          console.debug(`[openhands][${key}] ${deps.safeStringify(ev.value)}`);
        } catch (e) {
          console.debug(`[openhands][${key}] <failed to stringify: ${String(e)}>`); // Debug Console only
        }
      }
      return;
    }

    try {
      if (ev.kind === 'ObservationEvent' && ev.tool_name === 'file_editor') {
        const observation = ev.observation as { command?: unknown; path?: unknown } | undefined;
        const command = typeof observation?.command === 'string' ? observation.command : undefined;
        const filePath = typeof observation?.path === 'string' ? observation.path : undefined;
        if (command && command !== 'view' && filePath && path.isAbsolute(filePath)) {
          deps.trackAgentEditedFile?.(filePath);
        }
      }
    } catch (e) {
      outputChannel?.appendLine(`[error] Failed to track agent-edited files: ${String(e)}`);
    }

    if (!isLlmStreamUpdate) {
      const isErrorLike = ev.kind === 'ConversationErrorEvent' || ev.kind === 'AgentErrorEvent';
      if (deps.isVerboseEventLogging() || isErrorLike) {
        outputChannel?.appendLine(`[event] ${deps.safeStringify(ev)}`);
      } else {
        outputChannel?.appendLine(`[event] ${ev.kind}`);
      }
    }

    if (streamingUpdate.completed) {
      outputChannel?.appendLine('[llm] Streaming complete');
    }

    try {
      if (isStateUpdate && ev.key === 'llm_request') {
        const raw = ev.value as {
          model?: unknown;
          tools?: unknown;
          tool_count?: unknown;
        } | undefined;
        const model = typeof raw?.model === 'string' ? raw.model : undefined;
        const names = Array.isArray(raw?.tools)
          ? (raw?.tools as unknown[]).filter((n: unknown): n is string => typeof n === 'string')
          : [];
        const count = typeof raw?.tool_count === 'number' ? raw.tool_count : names.length;
        const summary = `[llm] Sending request${model ? ` to ${model}` : ''} with tools (${count}): ${names.join(', ')}`;
        outputChannel?.appendLine(summary);
      }
    } catch (e) {
      outputChannel?.appendLine(`[error] Failed to create LLM request summary: ${String(e)}`);
    }

    const shouldBufferForReplay = !isLlmStreamUpdate;
    const seq = shouldBufferForReplay ? deps.bufferConversationEvent(ev) : undefined;
    const payload: { type: 'event'; event: Event; seq?: number } = { type: 'event', event: ev };
    if (typeof seq === 'number') payload.seq = seq;
    const view = deps.getChatView();
    if (!view || !deps.isChatWebviewReady() || !view.visible) return;
    const transformed = deps.transformEventForWebview ? deps.transformEventForWebview(ev, view.webview) : ev;
    const message: HostToWebviewMessage = { ...payload, event: transformed };
    void view.webview.postMessage(message);
  });

  conversation.on('error', (err: unknown) => {
    const outputChannel = deps.getOutputChannel();

    const rendered = deps.renderError(err);
    outputChannel?.appendLine(`[error] ${rendered}`);
    if (err instanceof Error && err.stack) {
      outputChannel?.appendLine(err.stack);
    }
    postToChatIfVisible(deps, { type: 'error', error: rendered });
  });

  conversation.on('conversationStarted', (id: string | undefined) => {
    const outputChannel = deps.getOutputChannel();
    outputChannel?.appendLine(`[conversation] active=${id ?? 'undefined'}`);
    streamingState = initialLlmStreamingState;

    deps.resetConversationEventBacklog(id);
    deps.resetAgentEditedFiles?.();
    const mode = deps.getConversationMode();
    const scopedKey = mode === 'local' ? 'openhands.conversationId.local' : 'openhands.conversationId.remote';
    void deps.context.workspaceState.update(scopedKey, id);
    if (id) {
      postToChatIfVisible(deps, { type: 'conversationStarted', conversationId: id });
    }
  });

  conversation.on('terminal', (event: BashEvent) => deps.handleTerminalEvent(event));
}
