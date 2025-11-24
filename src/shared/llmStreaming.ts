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
    const nextContent = typeof event.value === 'string' ? event.value : null;
    next = {
      phase: nextContent !== null ? 'streaming' : 'idle',
      content: nextContent,
    };
    started = current.phase === 'idle' && next.phase === 'streaming';
    contentUpdated = true;
    // If streaming content is explicitly cleared, mark as complete as well
    completed = current.phase === 'streaming' && next.phase === 'idle';
    return { state: next, started, completed, contentUpdated };
  }

  if (
    current.phase === 'streaming' &&
    (isAgentErrorEvent(event) ||
      isConversationErrorEvent(event) ||
      (isMessageEvent(event) && event.llm_message.role === 'assistant') ||
      (isActionEvent(event) && event.source === 'agent'))
  ) {
    next = { phase: 'idle', content: null };
    completed = true;
  }

  return { state: next, started, completed, contentUpdated };
}

export const initialLlmStreamingState: LlmStreamingState = { phase: 'idle', content: null };
