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
} from './EventBlock';

interface VscodeApi {
  postMessage: (message: unknown) => void;
}

// Cache the VS Code API - it can only be acquired once per webview
let vscodeApiInstance: VscodeApi | undefined;

function getVscodeApi(): VscodeApi {
  if (vscodeApiInstance) {
    return vscodeApiInstance;
  }

  if (typeof window !== 'undefined') {
    const g = window as any;
    if (g.__OH_VSCODE_API__) {
      vscodeApiInstance = g.__OH_VSCODE_API__ as VscodeApi;
      return vscodeApiInstance as VscodeApi;
    }
    if (typeof g.acquireVsCodeApi === 'function') {
      vscodeApiInstance = g.acquireVsCodeApi();
      try { g.__OH_VSCODE_API__ = vscodeApiInstance; } catch {}
      return vscodeApiInstance as VscodeApi;
    }
  }

  // Fallback for non-vscode environments (e.g., tests)
  vscodeApiInstance = { postMessage: () => { /* noop for tests */ } };
  return vscodeApiInstance as VscodeApi;
}

type RenderedEvent = { id: number; event: Event };

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
  if (isMessageEvent(event)) return <MessageEventBlock event={event} index={index} />;
  if (isAgentErrorEvent(event)) return <AgentErrorBlock event={event} index={index} />;
  if (isConversationErrorEvent(event)) return <ConversationErrorBlock event={event} index={index} />;
  if (isPauseEvent(event)) return null; // Pause events only show in status bar
  if (isCondensation(event)) return <CondensationBlock event={event} index={index} />;

  // Fallback for unknown events
  const safeKind = (event as any)?.kind ?? 'unknown';
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
  const eventId = useRef(1);

  // Input state
  const [input, setInput] = useState('');
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

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

  // Skills state
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number }>>([]);

  // Refs
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
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

  // Handle incoming events
  const handleEvent = useCallback((e: unknown) => {
    const known = isEvent(e);

    // Track agent status from ConversationStateUpdateEvent
    if (known && isConversationStateUpdateEvent(e)) {
      if (e.agent_status) {
        setAgentStatus(e.agent_status);
        if (e.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
          showStatusMessage('warn', 'Agent is waiting for confirmation');
        }
        lastAgentStatusRef.current = e.agent_status;
      }
      return; // Don't render state update events
    }

    if (known) {
      // Track pending actions
      if (isActionEvent(e)) {
        setPendingActions((prev) => {
          const exists = prev.some((a) => a.tool_call_id === e.tool_call_id);
          return exists ? prev : [...prev, e];
        });
      }

      // Clear pending action when we receive its observation
      if (isObservationEvent(e) || isUserRejectObservation(e)) {
        setPendingActions((prev) => prev.filter((a) => a.tool_call_id !== e.tool_call_id));
        if (submissionTimeoutRef.current) {
          clearTimeout(submissionTimeoutRef.current);
          submissionTimeoutRef.current = null;
        }
        setIsSubmitting(false);
      }

      // Show status messages for certain events
      if (isAgentErrorEvent(e)) {
        showStatusMessage('error', e.error);
        if (submissionTimeoutRef.current) {
          clearTimeout(submissionTimeoutRef.current);
          submissionTimeoutRef.current = null;
        }
        setIsSubmitting(false);
      } else if (isPauseEvent(e)) {
        showStatusMessage('warn', 'Conversation paused');
      }
    }

    // Add event to the list for rendering
    if ((e as any)?.kind !== 'ConversationStateUpdateEvent') {
      setEvents((ev) => [...ev, { id: eventId.current++, event: e as any }]);
    }
  }, [showStatusMessage]);

  // Signal webview is ready on mount
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    vscodeApi.postMessage({ type: 'webviewReady' });
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
        error?: unknown;
        conversationId?: string;
        files?: string[];
        skills?: { label: string; path: string }[];
        conversations?: ConversationsList;
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
            const label = payload.serverUrl && payload.serverUrl.length > 0 ? payload.serverUrl : 'local mode';
            showStatusMessage('info', `Config updated: ${label}`);
          }
          if (payload.mode === 'local') {
            setMode('local');
            setStatusBanner({ message: 'Local mode: running without remote server', level: 'info' });
          } else if (payload.mode === 'remote') {
            setMode('remote');
          }
          break;
        case 'event':
          handleEvent(payload.event);
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
            eventId.current = 1;
            // No toast: UI clears and restored/started messages will render naturally
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
        case 'queryRenderedEvents':
          postMessage({
            type: 'renderedEventsResponse',
            count: events.length,
            eventTypes: events.map(e => (e.event as any).kind ?? (e.event as any).type)
          });
          break;
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

  // Auto-scroll to bottom when events change
  useEffect(() => {
    const el = endRef.current;
    if (el && 'scrollIntoView' in el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length]);

  // Handler functions
  const handleStartNewConversation = useCallback(() => {
    setStatusBanner({ message: 'Starting new conversation…', level: 'info' });
    setConversationId(undefined);
    setEvents([]);
    setPendingActions([]);
    setAgentStatus(undefined);
    eventId.current = 1;
    setInput('');
    setSelectedContextFiles([]);
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
    const baseText = input.trim();
    if (!baseText) return;

    const files = selectedContextFiles.slice();
    let finalText = baseText;
    if (files.length > 0) {
      const lines = files.map((f) => (workspaceFiles.includes(f) ? f : f));
      finalText += `\n\nUser has selected the following files for you to read:\n${lines.join('\n')}`;
    }

    setInput('');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setContextQuery('');
    setSelectedContextFiles([]);
    selectionRef.current = { start: 0, end: 0 };
    postMessage({ type: 'send', text: finalText });
  }, [input, postMessage, selectedContextFiles, workspaceFiles]);

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

  const handleToggleContextFile = useCallback((file: string) => {
    setSelectedContextFiles((prev) =>
      prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
    );
  }, []);

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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <Header
        status={status}
        mode={mode}
        conversationId={conversationId}
        onNewConversation={handleStartNewConversation}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onReconnect={handleReconnect}
      />

      {/* Main conversation area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
            <div className="text-6xl mb-4">🙌</div>
            <h2 className="text-xl font-semibold mb-2">Welcome to OpenHands</h2>
            <p className="text-sm opacity-80 max-w-md">
              Start a conversation to collaborate with your AI coding assistant.
              Ask questions, request implementations, or get help with your code.
            </p>
          </div>
        ) : (
          <>
            {events.map((ev, index) => (
              <EventBlock key={ev.id} event={ev.event} index={index} />
            ))}
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
          onChange={setInput}
          onSubmit={handleSendMessage}
          disabled={status === 'offline'}
          onOpenContext={handleOpenContext}
          contextCount={selectedContextFiles.length}
          onOpenSkills={handleOpenSkills}
          skillsCount={skills.length}
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
