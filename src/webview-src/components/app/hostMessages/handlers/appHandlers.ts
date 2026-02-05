import { isEvent } from '@openhands/agent-sdk-ts';
import { getVscodeApi } from '../../../../shared/vscodeApi';
import type { HostMessageHandlerOptions, HostMessageHandlerRegistry, WebviewPersistedState } from '../types';

export function createAppHandlers(
  options: Pick<HostMessageHandlerOptions,
    | 'agentStatusRef'
    | 'conversationIdRef'
    | 'eventId'
    | 'events'
    | 'handleConversationStarted'
    | 'handleEvent'
    | 'maybeUpdateHalFlow'
    | 'pendingActionsBatchIdRef'
    | 'pendingActionsRef'
    | 'postMessage'
    | 'setAgentStatus'
    | 'setAttachments'
    | 'setConversationId'
    | 'setEnabledToolIds'
    | 'setEvents'
    | 'setHistory'
    | 'setPendingActions'
    | 'setQueuedMessagesCount'
    | 'setSkills'
    | 'setShowToolsPopover'
    | 'setStreamingContent'
    | 'setTools'
    | 'setWorkspaceFiles'
    | 'uiStateRef'>,
): HostMessageHandlerRegistry {
  const {
    agentStatusRef,
    conversationIdRef,
    eventId,
    events,
    handleConversationStarted,
    handleEvent,
    maybeUpdateHalFlow,
    pendingActionsBatchIdRef,
    pendingActionsRef,
    postMessage,
    setAgentStatus,
    setAttachments,
    setConversationId,
    setEnabledToolIds,
    setEvents,
    setHistory,
    setPendingActions,
    setQueuedMessagesCount,
    setSkills,
    setShowToolsPopover,
    setStreamingContent,
    setTools,
    setWorkspaceFiles,
    uiStateRef,
  } = options;

  return {
    attachmentsSelected: (payload) => {
      if (!Array.isArray(payload.attachments)) {
        return;
      }

      setAttachments((prev) => {
        const existing = new Set(prev.map((a) => a.uri));
        const next = [...prev];
        for (const attachment of payload.attachments) {
          if (!attachment || typeof attachment.uri !== 'string' || typeof attachment.label !== 'string') {
            continue;
          }
          if (existing.has(attachment.uri)) {
            continue;
          }
          next.push(attachment);
          existing.add(attachment.uri);
        }
        return next;
      });
    },

    event: (payload) => {
      if (!isEvent(payload.event)) {
        return;
      }

      handleEvent(payload.event);
      if (typeof payload.seq === 'number') {
        const api = getVscodeApi();
        const prev = api.getState?.<WebviewPersistedState>() ?? {};
        api.setState?.({ ...prev, lastSeenSeq: payload.seq });
      }
    },

    conversationStarted: (payload) => {
      if (typeof payload.conversationId !== 'string') {
        return;
      }

      handleConversationStarted();
      conversationIdRef.current = payload.conversationId;
      setConversationId(payload.conversationId);
      setEvents([]);
      pendingActionsRef.current = [];
      pendingActionsBatchIdRef.current = null;
      setPendingActions([]);
      agentStatusRef.current = undefined;
      setAgentStatus(undefined);
      setQueuedMessagesCount(0);
      setStreamingContent(null);
      eventId.current = 1;
      setShowToolsPopover(false);
      postMessage({ type: 'requestTools' });
      // No toast: UI clears and restored/started messages will render naturally.
      const api = getVscodeApi();
      api.setState?.({ conversationId: payload.conversationId, lastSeenSeq: 0 });
      maybeUpdateHalFlow();
    },

    workspaceFiles: (payload) => {
      if (Array.isArray(payload.files)) {
        setWorkspaceFiles(payload.files.filter((file): file is string => typeof file === 'string'));
      }
    },

    skillsList: (payload) => {
      if (!Array.isArray(payload.skills)) {
        return;
      }

      setSkills(
        payload.skills.filter((skill): skill is { label: string; path: string } => (
          typeof skill === 'object'
          && skill !== null
          && typeof (skill as { label?: unknown }).label === 'string'
          && typeof (skill as { path?: unknown }).path === 'string'
        ))
      );
    },

    toolsList: (payload) => {
      if (!Array.isArray(payload.tools) || !Array.isArray(payload.enabledToolIds)) {
        return;
      }

      setTools(
        payload.tools
          .filter((tool): tool is { id: string; label: string; description?: string; isDefault?: boolean } => (
            typeof tool === 'object'
            && tool !== null
            && typeof (tool as { id?: unknown }).id === 'string'
            && typeof (tool as { label?: unknown }).label === 'string'
          ))
          .map((tool) => ({
            id: tool.id,
            label: tool.label,
            description: typeof (tool as { description?: unknown }).description === 'string'
              ? (tool as { description: string }).description
              : undefined,
            isDefault: typeof (tool as { isDefault?: unknown }).isDefault === 'boolean'
              ? (tool as { isDefault: boolean }).isDefault
              : undefined,
          }))
      );
      setEnabledToolIds(payload.enabledToolIds.filter((id): id is string => typeof id === 'string'));
    },

    queryUiState: (payload) => {
      if (typeof payload.requestId === 'string') {
        postMessage({ type: 'uiStateResponse', requestId: payload.requestId, ...uiStateRef.current });
      }
    },

    queryRenderedEvents: (payload) => {
      const eventSnapshots = events.map(({ event }) => {
        if ('kind' in event && typeof event.kind === 'string') {
          return event.kind;
        }
        if ('type' in event && typeof (event as { type?: unknown }).type === 'string') {
          return (event as { type: string }).type;
        }
        return 'unknown';
      });
      const eventTypes = eventSnapshots;
      const rendered = events.map(({ event }, index) => {
        const type = eventSnapshots[index] ?? 'unknown';
        const marker = (event as { e2e_marker?: unknown }).e2e_marker;
        const toolCallId = (event as { tool_call_id?: unknown }).tool_call_id;
        const role = type === 'MessageEvent'
          ? (event as { llm_message?: { role?: unknown } }).llm_message?.role
          : undefined;
        return {
          type,
          marker: typeof marker === 'string' ? marker : undefined,
          toolCallId: typeof toolCallId === 'string' ? toolCallId : undefined,
          role: typeof role === 'string' ? role : undefined,
        };
      });
      if (typeof payload.requestId === 'string') {
        postMessage({
          type: 'renderedEventsResponse',
          requestId: payload.requestId,
          count: events.length,
          eventTypes,
          events: rendered,
        });
      }
    },

    historyList: (payload) => {
      const list = Array.isArray(payload.conversations) ? payload.conversations : [];
      setHistory(list);
    },
  };
}
