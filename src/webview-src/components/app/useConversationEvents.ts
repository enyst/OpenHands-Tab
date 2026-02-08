import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  isActionEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isConversationStateUpdateEvent,
  isEvent,
  isMessageEvent,
  isObservationEvent,
  isPauseEvent,
  isUserRejectObservation,
  type ActionEvent,
  type Event,
  type MessageEvent,
} from '@smolpaws/agent-sdk';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../../shared/llmStreaming';
import { STATUS_MESSAGE_DISMISS_DELAY_MS } from '../../../shared/webviewMessages';
import { MAX_RENDERED_EVENTS } from '../../shared/constants';
import type { ConversationTotals } from './conversationTotals';
import { computeConversationTotalsFromStats, parseLlmUsageInputTokens } from './conversationStats';

type RenderedEvent = { id: number; event: Event };

type ShowStatusMessage = (
  level: 'info' | 'warn' | 'error',
  message: string,
  options?: { autoDismiss?: boolean; autoDismissDelay?: number }
) => void;

type UseConversationEventsOptions = {
  agentStatusRef: MutableRefObject<string | undefined>;
  lastAgentStatusRef: MutableRefObject<string | undefined>;
  pendingActionsRef: MutableRefObject<ActionEvent[]>;
  pendingActionsBatchIdRef: MutableRefObject<string | null>;
  submissionTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hasLlmUsageRef: MutableRefObject<boolean>;
  eventId: MutableRefObject<number>;
  showStatusMessage: ShowStatusMessage;
  maybeUpdateHalFlow: () => void;
  setAgentStatus: Dispatch<SetStateAction<string | undefined>>;
  setPendingActions: Dispatch<SetStateAction<ActionEvent[]>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setStreamingContent: Dispatch<SetStateAction<string | null>>;
  setEvents: Dispatch<SetStateAction<RenderedEvent[]>>;
  setQueuedMessagesCount: Dispatch<SetStateAction<number>>;
  setConversationTotals: Dispatch<SetStateAction<ConversationTotals>>;
};

const isRenderableEvent = (event: Event) => !isConversationStateUpdateEvent(event);

const isOptimisticUserMessageEvent = (event: Event): boolean => (
  isMessageEvent(event)
  && event.source === 'user'
  && typeof event.id === 'string'
  && event.id.startsWith('optimistic:')
);

const isEnvironmentInfoBlock = (text: string): boolean =>
  text.trimStart().toLowerCase().startsWith('<environment information>');

const OPTIMISTIC_DEDUPE_WINDOW_MS = 2000;

const isExtraInfoBlock = (text: string): boolean =>
  text.trimStart().toLowerCase().startsWith('<extra_info>');

const fingerprintMessageEvent = (event: MessageEvent): string => {
  const role = event.llm_message?.role ?? '';
  const content = Array.isArray(event.llm_message?.content) ? event.llm_message.content : [];
  const extended = Array.isArray(event.extended_content)
    ? event.extended_content.filter((c) => {
      if (c?.type === 'text' && typeof c.text === 'string') {
        return !isEnvironmentInfoBlock(c.text) && !isExtraInfoBlock(c.text);
      }
      return true;
    })
    : [];
  try {
    return JSON.stringify({ role, content, extended });
  } catch {
    const firstText = content.find((c) => c?.type === 'text' && typeof (c as { text?: unknown }).text === 'string') as { text?: string } | undefined;
    return `${role}:${firstText?.text ?? ''}`;
  }
};

export function useConversationEvents(options: UseConversationEventsOptions) {
  const {
    agentStatusRef,
    lastAgentStatusRef,
    pendingActionsRef,
    pendingActionsBatchIdRef,
    submissionTimeoutRef,
    hasLlmUsageRef,
    eventId,
    showStatusMessage,
    maybeUpdateHalFlow,
    setAgentStatus,
    setPendingActions,
    setIsSubmitting,
    setStreamingContent,
    setEvents,
    setQueuedMessagesCount,
    setConversationTotals,
  } = options;

  const streamingStateRef = useRef(initialLlmStreamingState);
  const recentUserMessageFingerprintsRef = useRef<Map<string, number>>(new Map());

  const handleConversationStateUpdate = useCallback((event: Event) => {
    if (!isConversationStateUpdateEvent(event)) return false;

    if (event.agent_status) {
      const previousStatus = agentStatusRef.current;
      agentStatusRef.current = event.agent_status;
      setAgentStatus(event.agent_status);
      if (event.agent_status !== 'RUNNING') {
        setQueuedMessagesCount(0);
      }
      if (event.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
        showStatusMessage('warn', 'Agent is waiting for confirmation');
      }
      if (previousStatus === 'WAITING_FOR_CONFIRMATION' && event.agent_status !== 'WAITING_FOR_CONFIRMATION') {
        pendingActionsRef.current = [];
        pendingActionsBatchIdRef.current = null;
        setPendingActions([]);
        if (submissionTimeoutRef.current) {
          clearTimeout(submissionTimeoutRef.current);
          submissionTimeoutRef.current = null;
        }
        setIsSubmitting(false);
      }
      lastAgentStatusRef.current = event.agent_status;
    }

    if (event.key === 'llm_usage') {
      const inputTokens = parseLlmUsageInputTokens(event.value);
      if (inputTokens !== null) {
        hasLlmUsageRef.current = true;
        setConversationTotals((prev) => {
          if (prev.contextTokens === inputTokens) return prev;
          return { ...prev, contextTokens: inputTokens };
        });
      }
    }

    if (event.key === 'stats') {
      const totals = computeConversationTotalsFromStats(event.value, {
        mainUsageId: 'agent',
      });
      if (totals) {
        setConversationTotals((prev) => {
          const nextContextTokens = hasLlmUsageRef.current ? prev.contextTokens : totals.contextTokens;
          const nextTotals: ConversationTotals = { ...totals, contextTokens: nextContextTokens };
          if (
            prev.contextTokens === nextTotals.contextTokens
            && prev.totalTokens === nextTotals.totalTokens
            && prev.totalCost === nextTotals.totalCost
            && prev.costIsKnown === nextTotals.costIsKnown
          ) {
            return prev;
          }
          return nextTotals;
        });
      }
    }

    return true;
  }, [
    agentStatusRef,
    hasLlmUsageRef,
    lastAgentStatusRef,
    pendingActionsBatchIdRef,
    pendingActionsRef,
    setAgentStatus,
    setConversationTotals,
    setIsSubmitting,
    setPendingActions,
    setQueuedMessagesCount,
    showStatusMessage,
    submissionTimeoutRef,
  ]);

  const handleStreamingUpdate = useCallback((event: Event) => {
    const streamingUpdate = reduceLlmStreamingState(streamingStateRef.current, event);
    streamingStateRef.current = streamingUpdate.state;

    if (streamingUpdate.started || streamingUpdate.completed || streamingUpdate.contentUpdated) {
      setStreamingContent(streamingUpdate.state.content);
    }
  }, [setStreamingContent]);

  const handlePendingActions = useCallback((event: Event) => {
    const clearSubmissionState = () => {
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    };

    // Helper to derive the pending-action batch ID from a list of actions.
    const getBatchIdFromActions = (actions: readonly ActionEvent[]): string | null => {
      const id = actions[0]?.llm_response_id;
      return typeof id === 'string' ? id : null;
    };

    // Helper to clear a pending action by tool_call_id and reset submission state.
    const clearPendingActionByToolCallId = (toolCallId: string) => {
      const prev = pendingActionsRef.current;
      const next = prev.filter((a) => a.tool_call_id !== toolCallId);
      if (next.length !== prev.length) {
        pendingActionsRef.current = next;
        pendingActionsBatchIdRef.current = getBatchIdFromActions(next);
        setPendingActions(next);
      }
      clearSubmissionState();
    };

    if (isActionEvent(event)) {
      const prev = pendingActionsRef.current;
      const exists = prev.some((a) => a.tool_call_id === event.tool_call_id);
      if (exists) return;

      const nextBatchId = typeof event.llm_response_id === 'string' ? event.llm_response_id : null;
      const prevBatchId = pendingActionsBatchIdRef.current ?? getBatchIdFromActions(prev);
      const next = prev.length && prevBatchId && nextBatchId && prevBatchId !== nextBatchId ? [event] : [...prev, event];

      pendingActionsRef.current = next;
      pendingActionsBatchIdRef.current = nextBatchId;
      setPendingActions(next);
    } else if (isObservationEvent(event) || isUserRejectObservation(event)) {
      clearPendingActionByToolCallId(event.tool_call_id);
    } else if (isAgentErrorEvent(event)) {
      // AgentErrorEvents go back to the LLM for self-correction; no status bar message needed.
      // Clear the matching pending action so the confirmation prompt updates.
      clearPendingActionByToolCallId(event.tool_call_id);
    } else if (isConversationErrorEvent(event)) {
      // ConversationErrorEvents are shown to user; AgentErrorEvents go to LLM
      const statusMessage = event.code === 'missing_llm_api_key'
        ? 'Missing API key. Set it in LLM Profiles.'
        : 'Conversation error occurred.';
      showStatusMessage('error', statusMessage, { autoDismiss: true, autoDismissDelay: STATUS_MESSAGE_DISMISS_DELAY_MS });
    } else if (isPauseEvent(event)) {
      showStatusMessage('warn', 'Conversation paused');
    }
  }, [pendingActionsBatchIdRef, pendingActionsRef, setIsSubmitting, setPendingActions, showStatusMessage, submissionTimeoutRef]);

  const handleRenderableEvent = useCallback((event: Event) => {
    if (!isRenderableEvent(event)) return;

    if (isMessageEvent(event) && event.source === 'user') {
      const fingerprint = fingerprintMessageEvent(event);
      const now = Date.now();
      const recent = recentUserMessageFingerprintsRef.current;
      for (const [key, timestamp] of recent.entries()) {
        if (now - timestamp > OPTIMISTIC_DEDUPE_WINDOW_MS) {
          recent.delete(key);
        }
      }
      if (isOptimisticUserMessageEvent(event)) {
        if (recent.has(fingerprint)) {
          return;
        }
      } else {
        recent.set(fingerprint, now);
        setQueuedMessagesCount((prev) => Math.max(0, prev - 1));
      }
    }

    setEvents((ev) => {
      let base = ev;
      if (isMessageEvent(event) && event.source === 'user' && !isOptimisticUserMessageEvent(event)) {
        const incomingFingerprint = fingerprintMessageEvent(event);
        const optimisticIndex = base.findIndex(({ event: existing }) => (
          isOptimisticUserMessageEvent(existing)
          && fingerprintMessageEvent(existing as MessageEvent) === incomingFingerprint
        ));
        if (optimisticIndex !== -1) {
          base = [...base.slice(0, optimisticIndex), ...base.slice(optimisticIndex + 1)];
        }
      }

      const next = [...base, { id: eventId.current++, event }];
      return next.length > MAX_RENDERED_EVENTS ? next.slice(-MAX_RENDERED_EVENTS) : next;
    });
  }, [eventId, setEvents, setQueuedMessagesCount]);

  const handleEvent = useCallback((incomingEvent: unknown) => {
    if (!isEvent(incomingEvent)) return;

    const event = incomingEvent;
    handleStreamingUpdate(event);
    if (handleConversationStateUpdate(event)) {
      maybeUpdateHalFlow();
      return;
    }

    handlePendingActions(event);
    maybeUpdateHalFlow();
    handleRenderableEvent(event);
  }, [handleConversationStateUpdate, handlePendingActions, handleRenderableEvent, handleStreamingUpdate, maybeUpdateHalFlow]);

  return { handleEvent };
}
