import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isEvent,
  isSystemPromptEvent,
  isActionEvent,
  isObservationEvent,
  isUserRejectObservation,
  isMessageEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isPauseEvent,
  isCondensation,
  isConversationStateUpdateEvent,
  type Event,
  type ActionEvent,
} from '@openhands/agent-sdk-ts';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../shared/llmStreaming';
import { getVscodeApi } from '../shared/vscodeApi';

// Component imports
import { Header } from './Header';
import { InputArea, ContextPicker, SkillsPopover } from './InputArea';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { StatusBanner } from './StatusBanner';
import { HistoryView } from './HistoryView';
import {
  SystemPromptEventBlock,
  ActionEventBlock,
  ObservationEventBlock,
  UserRejectBlock,
  AgentErrorBlock,
  ConversationErrorBlock,
  CondensationBlock,
  MessageEventBlock,
  StreamingMessageBlock,
} from './EventBlock';

type RenderedEvent = { id: number; event: Event };

const isRenderableEvent = (event: Event) => !isConversationStateUpdateEvent(event);

type WebviewPersistedState = {
  conversationId?: string;
  lastSeenSeq?: number;
};

type ConversationsList = Array<{
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
}>;

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 */
function EventBlock({ event, index }: { event: Event; index: number }) {
  if (isSystemPromptEvent(event)) return <SystemPromptEventBlock event={event} index={index} />;
  if (isActionEvent(event)) return <ActionEventBlock event={event} index={index} />;
  if (isObservationEvent(event)) return <ObservationEventBlock event={event} index={index} />;
  if (isUserRejectObservation(event)) return <UserRejectBlock event={event} index={index} />;
  if (isMessageEvent(event)) {
    const message = event.llm_message;
    if (message?.role === 'tool') return null;
    const hasRenderableContent = Array.isArray(message?.content)
      ? message.content.some((item) => {
        if (item.type === 'text') return item.text.trim().length > 0;
        return true;
      })
      : false;
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    if (message?.role === 'assistant' && hasToolCalls && !hasRenderableContent) {
      return null;
    }
    return <MessageEventBlock event={event} index={index} />;
  }
  if (isAgentErrorEvent(event)) return <AgentErrorBlock event={event} index={index} />;
  if (isConversationErrorEvent(event)) return <ConversationErrorBlock event={event} index={index} />;
  if (isPauseEvent(event)) return null; // Pause events only show in status bar
  if (isCondensation(event)) return <CondensationBlock event={event} index={index} />;

  // Fallback for unknown events
  const safeKind = 'kind' in event && typeof event.kind === 'string' ? event.kind : 'unknown';
  return (
    <div className="bg-white/5 border-l-[3px] border-gray-500 p-4 rounded-lg my-3">
      <div className="font-semibold mb-2">Unknown Event: {String(safeKind)}</div>
      <pre className="font-mono text-xs overflow-auto bg-black/20 p-3 rounded">
        {JSON.stringify(event ?? {}, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Status message debouncing configuration
 */
const STATUS_DEBOUNCE_MS = 600;
let lastStatusMessage = { level: '' as 'info' | 'warn' | 'error', message: '', at: 0 };

/**
 * Main App component: React webview root for OpenHands extension.
 */
export function App() {
  // Connection state
  const [status, setStatus] = useState<'online' | 'offline' | 'connecting'>('offline');
  const [mode, setMode] = useState<'local' | 'remote'>('remote');
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Events and conversation state
  const [events, setEvents] = useState<RenderedEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [pendingActions, setPendingActions] = useState<ActionEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const eventId = useRef(1);

  // Input state
  const [input, setInput] = useState('');
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ uri: string; label: string; sizeBytes?: number }>>([]);

  // UI state
  const [statusBanner, setStatusBanner] = useState<{ message: string; level: 'info' | 'warn' | 'error' } | null>(
    { message: 'Initializing…', level: 'info' }
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Context picker state
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [isMentionActive, setIsMentionActive] = useState(false);
  const mentionStartRef = useRef<number | null>(null);

  // Skills state
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number }>>([]);

  // Server selection state
  const [servers, setServers] = useState<{ url: string; label?: string }[]>([]);
  const [currentServerUrl, setCurrentServerUrl] = useState<string | undefined>(undefined);

  // Refs
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const streamingStateRef = useRef(initialLlmStreamingState);
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Post message helper
  const postMessage = useCallback((msg: unknown) => {
    const api = getVscodeApi();
    api.postMessage(msg);
  }, []);

  // Show status message with debouncing
  const showStatusMessage = useCallback((level: 'info' | 'warn' | 'error', message: string) => {
    const now = Date.now();
    if (lastStatusMessage.level === level && lastStatusMessage.message === message && now - lastStatusMessage.at < STATUS_DEBOUNCE_MS) {
      return;
    }
    lastStatusMessage = { level, message, at: now };
    setStatusBanner({ message, level });
  }, []);

  const handleConversationStateUpdate = useCallback((event: Event) => {
    if (!isConversationStateUpdateEvent(event)) return false;

    if (event.agent_status) {
      setAgentStatus(event.agent_status);
      if (event.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
        showStatusMessage('warn', 'Agent is waiting for confirmation');
      }
      lastAgentStatusRef.current = event.agent_status;
    }

    return true;
  }, [showStatusMessage]);

  const handleStreamingUpdate = useCallback((event: Event) => {
    const streamingUpdate = reduceLlmStreamingState(streamingStateRef.current, event);
    streamingStateRef.current = streamingUpdate.state;

    if (streamingUpdate.started || streamingUpdate.completed || streamingUpdate.contentUpdated) {
      setStreamingContent(streamingUpdate.state.content);
    }
  }, []);

  const handlePendingActions = useCallback((event: Event) => {
    const clearSubmissionState = () => {
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    };

    if (isActionEvent(event)) {
      setPendingActions((prev) => {
        const exists = prev.some((a) => a.tool_call_id === event.tool_call_id);
        return exists ? prev : [...prev, event];
      });
    } else if (isObservationEvent(event) || isUserRejectObservation(event)) {
      setPendingActions((prev) => prev.filter((a) => a.tool_call_id !== event.tool_call_id));
      clearSubmissionState();
    } else if (isAgentErrorEvent(event)) {
      showStatusMessage('error', event.error);
      clearSubmissionState();
    } else if (isPauseEvent(event)) {
      showStatusMessage('warn', 'Conversation paused');
    }
  }, [showStatusMessage]);

  const handleRenderableEvent = useCallback((event: Event) => {
    if (!isRenderableEvent(event)) return;

    setEvents((ev) => [...ev, { id: eventId.current++, event }]);
  }, []);

  // Handle incoming events
  const handleEvent = useCallback((incomingEvent: unknown) => {
    if (!isEvent(incomingEvent)) return;

    const event = incomingEvent;
    handleStreamingUpdate(event);
    if (handleConversationStateUpdate(event)) return;

    handlePendingActions(event);
    handleRenderableEvent(event);
  }, [handleConversationStateUpdate, handlePendingActions, handleRenderableEvent, handleStreamingUpdate]);

  // Signal webview is ready on mount
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    const sendReady = () => {
      const state = vscodeApi.getState?.<WebviewPersistedState>() ?? {};
      const payload: { type: 'webviewReady'; conversationId?: string; lastSeenSeq?: number } = { type: 'webviewReady' };
      if (typeof state.conversationId === 'string') payload.conversationId = state.conversationId;
      if (typeof state.lastSeenSeq === 'number') payload.lastSeenSeq = state.lastSeenSeq;
      vscodeApi.postMessage(payload);
      vscodeApi.postMessage({ type: 'requestSkills' });
    };

    sendReady();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendReady();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Message handler: processes incoming messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        status?: 'online' | 'offline' | 'connecting';
        serverUrl?: string | null;
        mode?: 'local' | 'remote';
        event?: unknown;
        seq?: unknown;
        error?: unknown;
        conversationId?: string;
        files?: string[];
        skills?: { label: string; path: string }[];
        conversations?: ConversationsList;
        servers?: { url: string; label?: string }[];
        attachments?: Array<{ uri: string; label: string; sizeBytes?: number }>;
      };

      switch (payload?.type) {
        case 'status':
          if (payload.status) {
            setStatus(payload.status);
            if (payload.mode === 'local' || payload.mode === 'remote') {
              setMode(payload.mode);
            }
            if (payload.mode === 'local') {
              setStatusBanner({ message: 'Local mode: running without remote server', level: 'info' });
            } else if (payload.status === 'connecting') {
              setStatusBanner({ message: 'Connecting to server…', level: 'info' });
            } else if (payload.status === 'online') {
              setStatusBanner({ message: 'Connected to server', level: 'info' });
            } else if (payload.status === 'offline') {
              setStatusBanner({ message: 'Disconnected from server', level: 'warn' });
            }
          }
          break;
        case 'configUpdated':
          if (typeof payload.serverUrl === 'string' || payload.serverUrl === null) {
            const url = payload.serverUrl || undefined;
            setCurrentServerUrl(url);
            const label = url || 'local mode';
            showStatusMessage('info', `Config updated: ${label}`);
          }
          if (payload.mode === 'local') {
            setMode('local');
            setCurrentServerUrl(undefined);
            setStatusBanner({ message: 'Local mode: running without remote server', level: 'info' });
          } else if (payload.mode === 'remote') {
            setMode('remote');
          }
          break;
        case 'serverListUpdated':
          if (Array.isArray(payload.servers)) {
            setServers(payload.servers);
          }
          if (typeof payload.serverUrl === 'string') {
            setCurrentServerUrl(payload.serverUrl || undefined);
          }
          break;
        case 'attachmentsSelected':
          if (Array.isArray(payload.attachments)) {
            setAttachments((prev) => {
              const existing = new Set(prev.map((a) => a.uri));
              const next = [...prev];
              for (const a of payload.attachments ?? []) {
                if (!a || typeof a.uri !== 'string' || typeof a.label !== 'string') continue;
                if (existing.has(a.uri)) continue;
                next.push(a);
                existing.add(a.uri);
              }
              return next;
            });
          }
          break;
        case 'event':
          if (isEvent(payload.event)) {
            handleEvent(payload.event);
            if (typeof payload.seq === 'number') {
              const api = getVscodeApi();
              const prev = api.getState?.<WebviewPersistedState>() ?? {};
              api.setState?.({ ...prev, lastSeenSeq: payload.seq });
            }
          }
          break;
        case 'error':
          if (typeof payload.error === 'string') {
            setStatusBanner({ message: payload.error, level: 'error' });
          } else {
            setStatusBanner({ message: 'An unknown error occurred', level: 'error' });
          }
          break;
        case 'conversationStarted':
          if (typeof payload.conversationId === 'string') {
            setConversationId(payload.conversationId);
            setEvents([]);
            setPendingActions([]);
            setAgentStatus(undefined);
            setStreamingContent(null);
            eventId.current = 1;
            // No toast: UI clears and restored/started messages will render naturally
            const api = getVscodeApi();
            api.setState?.({ conversationId: payload.conversationId, lastSeenSeq: 0 });
          }
          break;
        case 'workspaceFiles':
          if (Array.isArray(payload.files)) {
            setWorkspaceFiles(payload.files.filter((f): f is string => typeof f === 'string'));
          }
          break;
        case 'skillsList':
          if (Array.isArray(payload.skills)) {
            setSkills(payload.skills);
          }
          break;
        case 'queryRenderedEvents': {
          const eventTypes = events.map(({ event }) => {
            if ('kind' in event && typeof event.kind === 'string') return event.kind;
            if ('type' in event && typeof (event as { type?: unknown }).type === 'string') {
              return (event as { type: string }).type;
            }
            return 'unknown';
          });
          postMessage({
            type: 'renderedEventsResponse',
            count: events.length,
            eventTypes
          });
          break;
        }
        case 'historyList': {
          const list = Array.isArray(payload.conversations) ? payload.conversations : [];
          setHistory(list);
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [events, handleEvent, postMessage, showStatusMessage]);

  // Auto-scroll to bottom when events change or streaming updates
  useEffect(() => {
    const el = endRef.current;
    if (el && 'scrollIntoView' in el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, streamingContent]);

  // Shared mention detection logic
  const updateMentionState = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');

    // Clear mention if no @ or whitespace after @
    if (at === -1 || /\s/.test(before.slice(at + 1))) {
      if (isMentionActive) {
        setIsMentionActive(false);
        setShowContextPicker(false);
        setContextQuery('');
        mentionStartRef.current = null;
      }
      return;
    }

    // Activate mention mode
    const afterAt = before.slice(at + 1);
    mentionStartRef.current = at;
    setIsMentionActive(true);
    setShowSkillsPopover(false);
    if (!showContextPicker) {
      postMessage({ type: 'requestWorkspaceFiles' });
      setShowContextPicker(true);
    }
    setContextQuery(afterAt);
  }, [isMentionActive, postMessage, showContextPicker]);

  // Selection tracking from InputArea
  const handleSelectionChange = useCallback((start: number, end: number) => {
    selectionRef.current = { start, end };
    updateMentionState(input, end);
  }, [input, updateMentionState]);

  // Input change with mention detection
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    updateMentionState(value, selectionRef.current.end);
  }, [updateMentionState]);

  // Handler functions
  const handleStartNewConversation = useCallback(() => {
    setStatusBanner({ message: 'Starting new conversation…', level: 'info' });
    setConversationId(undefined);
    setEvents([]);
    setPendingActions([]);
    setAgentStatus(undefined);
    setStreamingContent(null);
    eventId.current = 1;
    setInput('');
    setSelectedContextFiles([]);
    setAttachments([]);
    postMessage({ type: 'command', command: 'startNewConversation' });
  }, [postMessage]);

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true);
    postMessage({ type: 'requestHistory' });
  }, [postMessage]);

  const handleOpenSettings = useCallback(() => {
    postMessage({ type: 'openSettingsPage' });
  }, [postMessage]);

  const handleReconnect = useCallback(() => {
    postMessage({ type: 'command', command: 'reconnect' });
  }, [postMessage]);

  const handleSendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    setInput('');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setContextQuery('');
    setSelectedContextFiles([]);
    setAttachments([]);
    selectionRef.current = { start: 0, end: 0 };
    postMessage({
      type: 'send',
      text,
      contextFiles: selectedContextFiles.slice(),
      attachments: attachments.map((a) => a.uri),
    });
  }, [attachments, input, postMessage, selectedContextFiles]);

  const handleApprove = useCallback(() => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      showStatusMessage('warn', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'approveAction' });
    showStatusMessage('info', 'Approval submitted');
  }, [isSubmitting, postMessage, showStatusMessage]);

  const handleReject = useCallback((reason?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      showStatusMessage('warn', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'rejectAction', reason });
    showStatusMessage('info', 'Rejection submitted');
  }, [isSubmitting, postMessage, showStatusMessage]);

  // Context picker handlers
  const handleOpenContext = useCallback(() => {
    setShowSkillsPopover(false);
    setShowContextPicker((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestWorkspaceFiles' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  // Attachments handlers
  const handleOpenAttachments = useCallback(() => {
    postMessage({ type: 'selectAttachments' });
  }, [postMessage]);

  const handleOpenAttachment = useCallback((uri: string) => {
    postMessage({ type: 'openAttachment', uri });
  }, [postMessage]);

  const handleRemoveAttachment = useCallback((uri: string) => {
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));
  }, []);

  const handleToggleContextFile = useCallback((file: string) => {
    if (isMentionActive && mentionStartRef.current !== null) {
      // Ensure file is in selected context
      setSelectedContextFiles((prev) => (prev.includes(file) ? prev : [...prev, file]));

      const caret = selectionRef.current.end;
      const start = mentionStartRef.current;
      const before = input.slice(0, start);
      const after = input.slice(caret);
      const inserted = `@${file} `;
      const next = before + inserted + after;
      setInput(next);

      // Place caret after inserted mention
      setTimeout(() => {
        const textarea = document.getElementById('openhands-chat-input') as HTMLTextAreaElement | null;
        if (textarea) {
          const pos = (before + inserted).length;
          try { textarea.setSelectionRange(pos, pos); } catch { }
        }
      }, 0);

      // Close mention/context picker
      setIsMentionActive(false);
      setShowContextPicker(false);
      setContextQuery('');
      mentionStartRef.current = null;
    } else {
      setSelectedContextFiles((prev) =>
        prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
      );
    }
  }, [input, isMentionActive]);

  // Skills handlers
  const handleOpenSkills = useCallback(() => {
    setShowContextPicker(false);
    setShowSkillsPopover((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestSkills' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  const handleOpenSkill = useCallback((path: string) => {
    showStatusMessage('info', 'Opening skill…');
    postMessage({ type: 'openSkill', path });
    setShowSkillsPopover(false);
  }, [postMessage, showStatusMessage]);

  // History handlers
  const handleSelectConversation = useCallback((id: string) => {
    // No toast on restore; the UI will be repopulated with restored events
    postMessage({ type: 'restoreConversation', id });
  }, [postMessage]);

  // Server selection handlers
  const handleSelectServer = useCallback((url: string) => {
    postMessage({ type: 'selectServer', url });
  }, [postMessage]);

  const handleAddServer = useCallback((server: { url: string; label?: string }) => {
    postMessage({ type: 'addServer', server });
  }, [postMessage]);

  const handleRemoveServer = useCallback((url: string) => {
    postMessage({ type: 'removeServer', url });
  }, [postMessage]);

  const handleSwitchToLocal = useCallback(() => {
    postMessage({ type: 'switchToLocal' });
  }, [postMessage]);

  // Derived state: conversation is empty when no events and no streaming
  const isEmptyConversation = events.length === 0 && streamingContent === null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <Header
        status={status}
        mode={mode}
        conversationId={conversationId}
        currentServerUrl={currentServerUrl}
        servers={servers}
        onNewConversation={handleStartNewConversation}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onReconnect={handleReconnect}
        onSelectServer={handleSelectServer}
        onAddServer={handleAddServer}
        onRemoveServer={handleRemoveServer}
        onSwitchToLocal={handleSwitchToLocal}
      />

      {/* Main conversation area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isEmptyConversation ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-6xl mb-6">🙌</div>
            <h2 className="text-2xl font-semibold mb-3 text-stone-100">Welcome to OpenHands</h2>
            <p className="text-sm text-stone-400 max-w-md leading-relaxed">
              Start a conversation to collaborate with your AI coding assistant.
              Ask questions, request implementations, or get help with your code.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
              <span className="codicon codicon-lightbulb text-brand-400" />
              <span>Type a message below to get started</span>
            </div>
          </div>
        ) : (
          <>
            {events.map((ev, index) => (
              <EventBlock key={ev.id} event={ev.event} index={index} />
            ))}
            {streamingContent !== null && (
              <StreamingMessageBlock content={streamingContent} />
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* Confirmation prompt (modal overlay) */}
      {agentStatus === 'WAITING_FOR_CONFIRMATION' && pendingActions.length > 0 && (
        <ConfirmationPrompt
          pendingActions={pendingActions}
          onApprove={handleApprove}
          onReject={handleReject}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Input area */}
      <div className="relative">
        <InputArea
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSendMessage}
          disabled={status === 'offline'}
          onOpenContext={handleOpenContext}
          contextCount={selectedContextFiles.length}
          onOpenSkills={handleOpenSkills}
          skillsCount={skills.length}
          onOpenAttachments={handleOpenAttachments}
          attachments={attachments}
          onOpenAttachment={handleOpenAttachment}
          onRemoveAttachment={handleRemoveAttachment}
          onSelectionChange={handleSelectionChange}
        />

        {/* Context picker popover */}
        <ContextPicker
          isOpen={showContextPicker}
          onClose={() => setShowContextPicker(false)}
          files={workspaceFiles}
          selectedFiles={selectedContextFiles}
          onToggleFile={handleToggleContextFile}
          searchQuery={contextQuery}
          onSearchChange={setContextQuery}
        />

        {/* Skills popover */}
        <SkillsPopover
          isOpen={showSkillsPopover}
          onClose={() => setShowSkillsPopover(false)}
          skills={skills}
          onOpenSkill={handleOpenSkill}
        />

        {/* Status banner */}
        {statusBanner && (
          <div className="px-4 pb-4">
            <StatusBanner
              message={statusBanner.message}
              level={statusBanner.level}
              onDismiss={() => setStatusBanner(null)}
              autoDismiss={statusBanner.level !== 'error'}
            />
          </div>
        )}
      </div>

      {/* History view (slide-over panel) */}
      <HistoryView
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        conversations={history}
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
      />
    </div>
  );
}
