import {
  type Event,
  isActionEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isConversationStateUpdateEvent,
  isMessageEvent,
} from '@openhands/agent-sdk-ts';

export type LlmStreamingPhase = 'idle' | 'streaming';

export interface LlmStreamingState {
  phase: LlmStreamingPhase;
  content: string | null;
  /**
   * Offset into the agent's cumulative llm_stream text where the current response began.
   */
  sessionStartOffset: number;
  /**
   * Length of the cumulative llm_stream text as of the latest update we processed.
   */
  lastGlobalLength: number;
}

export interface LlmStreamingUpdateResult {
  state: LlmStreamingState;
  /**
   * True when the stream transitions from idle → streaming.
   */
  started: boolean;
  /**
   * True when the stream transitions from streaming → idle because the agent completed, errored, or aborted.
   */
  completed: boolean;
  /**
   * True when the ConversationStateUpdateEvent provided new content (including clearing content).
   */
  contentUpdated: boolean;
}

/**
 * Canonical LLM streaming contract for the extension + webview.
 *
 * Start condition
 * - The first ConversationStateUpdateEvent with `key === 'llm_stream'` and a string `value`
 *   transitions the phase to `streaming` and records the latest content.
 *
 * End conditions
 * - An assistant MessageEvent, agent ActionEvent, AgentErrorEvent, or ConversationErrorEvent
 *   always ends streaming (clears content) because the LLM response is complete or aborted.
 * - A ConversationStateUpdateEvent with `key === 'llm_stream'` but non-string value clears
 *   streaming content and resets the phase to idle.
 */
export function reduceLlmStreamingState(current: LlmStreamingState, event: Event): LlmStreamingUpdateResult {
  let next = current;
  let started = false;
  let completed = false;
  let contentUpdated = false;

  if (isConversationStateUpdateEvent(event) && event.key === 'llm_stream') {
    if (typeof event.value === 'string') {
      const globalValue = event.value;
      const globalLength = globalValue.length;
      const sessionStartOffset = current.phase === 'idle' ? current.lastGlobalLength : current.sessionStartOffset;
      next = {
        phase: 'streaming',
        content: globalValue.slice(sessionStartOffset),
        sessionStartOffset,
        lastGlobalLength: globalLength,
      };
      started = current.phase === 'idle';
      contentUpdated = true;
      return { state: next, started, completed, contentUpdated };
    }

    next = {
      phase: 'idle',
      content: null,
      sessionStartOffset: current.lastGlobalLength,
      lastGlobalLength: current.lastGlobalLength,
    };
    completed = current.phase === 'streaming';
    contentUpdated = current.content !== null;
    return { state: next, started, completed, contentUpdated };
  }

  if (
    current.phase === 'streaming' &&
    (isAgentErrorEvent(event) ||
      isConversationErrorEvent(event) ||
      (isMessageEvent(event) && event.llm_message.role === 'assistant') ||
      (isActionEvent(event) && event.source === 'agent'))
  ) {
    next = {
      phase: 'idle',
      content: null,
      sessionStartOffset: current.lastGlobalLength,
      lastGlobalLength: current.lastGlobalLength,
    };
    completed = true;
  }

  return { state: next, started, completed, contentUpdated };
}

export const initialLlmStreamingState: LlmStreamingState = {
  phase: 'idle',
  content: null,
  sessionStartOffset: 0,
  lastGlobalLength: 0,
};
