import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  isActionEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isConversationStateUpdateEvent,
  isEvent,
  isObservationEvent,
  isPauseEvent,
  isUserRejectObservation,
  type ActionEvent,
  type Event,
} from '@openhands/agent-sdk-ts';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../../shared/llmStreaming';
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
  setConversationTotals: Dispatch<SetStateAction<ConversationTotals>>;
};

const isRenderableEvent = (event: Event) => !isConversationStateUpdateEvent(event);

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
    setConversationTotals,
  } = options;

  const streamingStateRef = useRef(initialLlmStreamingState);

  const handleConversationStateUpdate = useCallback((event: Event) => {
    if (!isConversationStateUpdateEvent(event)) return false;

    if (event.agent_status) {
      const previousStatus = agentStatusRef.current;
      agentStatusRef.current = event.agent_status;
      setAgentStatus(event.agent_status);
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
      const totals = computeConversationTotalsFromStats(event.value);
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
      const prev = pendingActionsRef.current;
      const next = prev.filter((a) => a.tool_call_id !== event.tool_call_id);
      if (next.length !== prev.length) {
        pendingActionsRef.current = next;
        pendingActionsBatchIdRef.current = getBatchIdFromActions(next);
        setPendingActions(next);
      }
      clearSubmissionState();
    } else if (isAgentErrorEvent(event)) {
      showStatusMessage('error', event.error);
      clearSubmissionState();
    } else if (isConversationErrorEvent(event) && event.code === 'missing_llm_api_key') {
      showStatusMessage('error', 'Missing API key. Set it in LLM Profiles.', { autoDismiss: true, autoDismissDelay: 8000 });
    } else if (isPauseEvent(event)) {
      showStatusMessage('warn', 'Conversation paused');
    }
  }, [pendingActionsBatchIdRef, pendingActionsRef, setIsSubmitting, setPendingActions, showStatusMessage, submissionTimeoutRef]);

  const handleRenderableEvent = useCallback((event: Event) => {
    if (!isRenderableEvent(event)) return;

    setEvents((ev) => {
      const next = [...ev, { id: eventId.current++, event }];
      return next.length > MAX_RENDERED_EVENTS ? next.slice(-MAX_RENDERED_EVENTS) : next;
    });
  }, [eventId, setEvents]);

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

