// React must be in scope for JSX to work after esbuild transpilation
import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
/*
  App.tsx - Neo-Brutalist Command Center Design
  A distinctive, warm-technical interface for OpenHands Tab
*/

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
  isTextContent,
  type Event,
  type ActionEvent,
  type ObservationEvent,
  type MessageEvent as AgentMessageEvent,
  type SystemPromptEvent,
  type UserRejectObservation,
  type AgentErrorEvent,
  type ConversationErrorEvent,
  type PauseEvent,
  type Condensation,
} from '@openhands/agent-sdk-ts';

interface VscodeApi {
  postMessage: (message: unknown) => void;
}

// Cache the VS Code API - it can only be acquired once per webview
// Store on window to survive hot module reloading
declare global {
  interface Window {
    __vscodeApi?: VscodeApi;
  }
}

function getVscodeApi(): VscodeApi {
  // Check if already cached on window (survives HMR)
  if (typeof window !== 'undefined' && window.__vscodeApi) {
    return window.__vscodeApi;
  }

  if (typeof window !== 'undefined' && 'acquireVsCodeApi' in window && typeof (window as { acquireVsCodeApi?: () => VscodeApi }).acquireVsCodeApi === 'function') {
    const api = (window as { acquireVsCodeApi: () => VscodeApi }).acquireVsCodeApi();
    window.__vscodeApi = api;
    return api;
  }

  // Fallback for non-vscode environments (e.g., tests)
  const fallback: VscodeApi = { postMessage: () => { /* noop for tests */ } };
  if (typeof window !== 'undefined') {
    window.__vscodeApi = fallback;
  }
  return fallback;
}

type RenderedEvent = { id: number; event: Event };

type ConversationsList = Array<{
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
}>;

// ============================================
// EVENT RENDERING COMPONENTS
// ============================================

function SystemPromptEventBlock({ event }: { event: SystemPromptEvent }) {
  return (
    <div className="oh-event event-system">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-terminal" />
            </span>
            System Prompt
          </div>
          <span className="oh-event-meta">INIT</span>
        </div>
        <div className="oh-event-content">
          <div className="whitespace-pre-wrap">{event.system_prompt.text}</div>
          {event.tools && event.tools.length > 0 && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Available Tools</div>
              <span className="oh-code">{event.tools.length} tools loaded</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionEventBlock({ event }: { event: ActionEvent }) {
  const thought = event.thought.map((t) => t.text).join('\n');
  const isExecuted = event.action !== null;
  return (
    <div className="oh-event event-action">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-play" />
            </span>
            Agent Action
            {!isExecuted && <span className="oh-code ml-2">NOT EXECUTED</span>}
          </div>
          {event.security_risk && event.security_risk !== 'UNKNOWN' && (
            <div className={`oh-risk-badge ${event.security_risk.toLowerCase()}`}>
              <span>{event.security_risk}</span>
            </div>
          )}
        </div>
        <div className="oh-event-content">
          {event.reasoning_content && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Reasoning</div>
              <div className="whitespace-pre-wrap">{event.reasoning_content}</div>
            </div>
          )}
          {thought && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Thought</div>
              <div className="whitespace-pre-wrap">{thought}</div>
            </div>
          )}
          {event.tool_name && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Tool</div>
              <span className="oh-code">{event.tool_name}</span>
            </div>
          )}
          {event.action && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Action Details</div>
              <pre>{JSON.stringify(event.action, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObservationEventBlock({ event }: { event: ObservationEvent }) {
  const [expanded, setExpanded] = useState(false);
  const output = JSON.stringify(event.observation, null, 2);
  const tooLong = output.length > 2000;
  const shown = expanded || !tooLong ? output : output.slice(0, 2000) + '\n…';
  return (
    <div className="oh-event event-observation">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-eye" />
            </span>
            Observation
          </div>
          <span className="oh-event-meta">RESULT</span>
        </div>
        <div className="oh-event-content">
          <div className="oh-event-section">
            <div className="oh-event-section-title">Tool</div>
            <span className="oh-code">{event.tool_name}</span>
          </div>
          <div className="oh-event-section">
            <div className="oh-event-section-title">Output</div>
            <pre>{shown}</pre>
          </div>
          {tooLong && (
            <button className="oh-expand-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? '← Show less' : 'Show more →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRejectBlock({ event }: { event: UserRejectObservation }) {
  return (
    <div className="oh-event event-reject">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-close" />
            </span>
            Action Rejected
          </div>
          <span className="oh-event-meta">DENIED</span>
        </div>
        <div className="oh-event-content">
          <div className="oh-event-section">
            <div className="oh-event-section-title">Tool</div>
            <span className="oh-code">{event.tool_name}</span>
          </div>
          <div className="oh-event-section">
            <div className="oh-event-section-title">Reason</div>
            <div className="whitespace-pre-wrap">{event.rejection_reason}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentErrorBlock({ event }: { event: AgentErrorEvent }) {
  return (
    <div className="oh-event event-error">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-error" />
            </span>
            Agent Error
          </div>
          <span className="oh-event-meta">ERROR</span>
        </div>
        <div className="oh-event-content">
          <div className="oh-event-section">
            <div className="oh-event-section-title">Error Details</div>
            <div className="whitespace-pre-wrap" style={{ color: 'var(--oh-error)' }}>{event.error}</div>
          </div>
          {event.tool_name && (
            <div className="mt-2 text-sm opacity-70">Tool: {event.tool_name}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationErrorBlock({ event }: { event: ConversationErrorEvent }) {
  return (
    <div className="oh-event event-error">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-warning" />
            </span>
            Conversation Error
          </div>
          <span className="oh-event-meta">ERROR</span>
        </div>
        <div className="oh-event-content">
          {event.code && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Code</div>
              <span className="oh-code">{event.code}</span>
            </div>
          )}
          {event.detail && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Details</div>
              <div className="whitespace-pre-wrap" style={{ color: 'var(--oh-error)' }}>{event.detail}</div>
            </div>
          )}
          {!event.detail && !event.code && (
            <div className="mt-1 text-sm opacity-70">Additional information unavailable.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PauseEventBlock({ event: _event }: { event: PauseEvent }) {
  return (
    <div className="oh-event event-pause">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-debug-pause" />
            </span>
            Paused
          </div>
          <span className="oh-event-meta">HALT</span>
        </div>
        <div className="oh-event-content">
          <div className="text-sm opacity-80">Conversation paused by user</div>
        </div>
      </div>
    </div>
  );
}

function CondensationBlock({ event }: { event: Condensation }) {
  return (
    <div className="oh-event event-condensation">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-fold" />
            </span>
            Memory Condensed
          </div>
          <span className="oh-event-meta">OPTIMIZE</span>
        </div>
        <div className="oh-event-content">
          <div className="oh-event-section">
            <div className="oh-event-section-title">Events Condensed</div>
            <span className="oh-code">{event.forgotten_event_ids.length} events</span>
          </div>
          {event.summary && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Summary</div>
              <div className="whitespace-pre-wrap">{event.summary}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageEventBlock({ event }: { event: AgentMessageEvent }) {
  const role = event.llm_message.role;
  const textParts = event.llm_message.content.filter(isTextContent).map((c) => c.text);
  const content = textParts.join('\n');

  const imageParts = event.llm_message.content.filter((c): c is { type: 'image'; image_urls?: string[]; detail?: string } =>
    c.type === 'image'
  );

  const eventClass = role === 'user' ? 'event-message-user' : 'event-message-assistant';
  const icon = role === 'user' ? 'account' : 'hubot';
  const label = role === 'user' ? 'USER' : 'AGENT';

  return (
    <div className={`oh-event ${eventClass}`}>
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className={`codicon codicon-${icon}`} />
            </span>
            {event.source || role}
          </div>
          <span className="oh-event-meta">{label}</span>
        </div>
        <div className="oh-event-content">
          {content && <div className="whitespace-pre-wrap">{content}</div>}
          {imageParts.length > 0 && (
            <div className="mt-2">
              {imageParts.map((img, idx) => (
                <div key={idx} className="text-sm opacity-70">
                  <span className="codicon codicon-file-media mr-1" />
                  Image {img.image_urls && img.image_urls.length > 0 ? `(${img.image_urls.length} url${img.image_urls.length > 1 ? 's' : ''})` : ''}
                </div>
              ))}
            </div>
          )}
          {event.llm_message.reasoning_content && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Reasoning</div>
              <div className="whitespace-pre-wrap mt-1">{event.llm_message.reasoning_content}</div>
            </div>
          )}
          {(() => {
            const activated = event.activated_skills;
            if (!activated || activated.length === 0) return null;
            return (
              <div className="oh-event-section">
                <div className="oh-event-section-title">Activated Skills</div>
                <span className="oh-code">{activated.join(', ')}</span>
              </div>
            );
          })()}
          {event.extended_content && event.extended_content.length > 0 && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Extended Context</div>
              <div className="whitespace-pre-wrap mt-1">{event.extended_content.map(c => c.text).join(' ')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 */
function EventBlock({ event }: { event: Event }) {
  if (isSystemPromptEvent(event)) return <SystemPromptEventBlock event={event} />;
  if (isActionEvent(event)) return <ActionEventBlock event={event} />;
  if (isObservationEvent(event)) return <ObservationEventBlock event={event} />;
  if (isUserRejectObservation(event)) return <UserRejectBlock event={event} />;
  if (isMessageEvent(event)) return <MessageEventBlock event={event} />;
  if (isAgentErrorEvent(event)) return <AgentErrorBlock event={event} />;
  if (isConversationErrorEvent(event)) return <ConversationErrorBlock event={event} />;
  if (isPauseEvent(event)) return <PauseEventBlock event={event} />;
  if (isCondensation(event)) return <CondensationBlock event={event} />;

  // Fallback for unknown events
  const safeKind = (event as any)?.kind ?? 'unknown';
  return (
    <div className="oh-event">
      <div className="oh-event-indicator" />
      <div className="oh-event-card">
        <div className="oh-event-header">
          <div className="oh-event-title">
            <span className="oh-event-icon">
              <span className="codicon codicon-question" />
            </span>
            Unknown Event
          </div>
          <span className="oh-event-meta">{String(safeKind)}</span>
        </div>
        <div className="oh-event-content">
          <pre>{JSON.stringify(event ?? {}, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

// ============================================
// STATUS & DEBOUNCE CONFIGURATION
// ============================================

const STATUS_DEBOUNCE_MS = 600;
const STATUS_AUTO_DISMISS_MS = 5000;
let lastStatusMessage = { level: '' as 'info' | 'warn' | 'error', message: '', at: 0 };

// ============================================
// CONFIRMATION PROMPT
// ============================================

interface ConfirmationPromptProps {
  actions: ActionEvent[];
  onApprove: () => void;
  onReject: (reason?: string) => void;
  isSubmitting: boolean;
}

function ConfirmationPrompt({ actions, onApprove, onReject, isSubmitting }: ConfirmationPromptProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  if (actions.length === 0) return null;

  const handleReject = () => {
    onReject(rejectReason || undefined);
    setShowRejectInput(false);
    setRejectReason('');
  };

  return (
    <div className="oh-confirmation">
      <div className="oh-confirmation-title">
        <span className="codicon codicon-shield" />
        Action Confirmation Required
      </div>

      {actions.map((action) => (
        <div key={action.tool_call_id} className="mb-4 pb-4 border-b border-[rgba(255,225,101,0.2)] last:border-b-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="oh-code">{action.tool_name}</span>
            {action.security_risk && action.security_risk !== 'UNKNOWN' && (
              <div className={`oh-risk-badge ${action.security_risk.toLowerCase()}`}>
                <span>{action.security_risk}</span>
              </div>
            )}
          </div>
          {action.thought && action.thought.length > 0 && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Thought</div>
              <div className="text-sm whitespace-pre-wrap mt-1">
                {action.thought.map(t => t.text).join('\n')}
              </div>
            </div>
          )}
          {action.action && (
            <div className="oh-event-section">
              <div className="oh-event-section-title">Action Details</div>
              <pre className="text-xs max-h-32 overflow-auto">
                {JSON.stringify(action.action, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}

      <div className="oh-confirmation-actions">
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="oh-btn oh-btn-primary"
        >
          <span className="codicon codicon-check mr-2" />
          Approve
        </button>
        {!showRejectInput ? (
          <button
            type="button"
            onClick={() => setShowRejectInput(true)}
            disabled={isSubmitting}
            className="oh-btn oh-btn-danger"
          >
            <span className="codicon codicon-close mr-2" />
            Reject
          </button>
        ) : (
          <>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={isSubmitting}
              placeholder="Reason (optional)"
              className="oh-popover-search flex-1"
            />
            <button
              type="button"
              onClick={handleReject}
              disabled={isSubmitting}
              className="oh-btn oh-btn-danger"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setShowRejectInput(false)}
              disabled={isSubmitting}
              className="oh-btn oh-btn-secondary"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// MAIN APP COMPONENT
// ============================================

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
  const [contextActiveIndex, setContextActiveIndex] = useState(0);
  const [workspaceFilesRequested, setWorkspaceFilesRequested] = useState(false);
  const [isContextLoading, setIsContextLoading] = useState(false);

  // Skills state
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);
  const [skillsActiveIndex, setSkillsActiveIndex] = useState(0);
  const [skillsRequested, setSkillsRequested] = useState(false);
  const [isSkillsLoading, setIsSkillsLoading] = useState(false);

  // History state
  const [history, setHistory] = useState<ConversationsList>([]);

  // Refs
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusAutoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPopoverRef = useRef<HTMLDivElement | null>(null);
  const skillsPopoverRef = useRef<HTMLDivElement | null>(null);

  // Post message helper
  const postMessage = useCallback((msg: unknown) => {
    const api = getVscodeApi();
    api.postMessage(msg);
  }, []);

  // Show status message with debouncing and auto-dismiss
  const showStatusMessage = useCallback((level: 'info' | 'warn' | 'error', message: string, autoDismiss = true) => {
    const now = Date.now();
    if (lastStatusMessage.level === level && lastStatusMessage.message === message && now - lastStatusMessage.at < STATUS_DEBOUNCE_MS) {
      return;
    }
    lastStatusMessage = { level, message, at: now };

    if (statusAutoDismissRef.current) {
      clearTimeout(statusAutoDismissRef.current);
      statusAutoDismissRef.current = null;
    }

    setStatusBanner({ message, level });

    if (autoDismiss && level !== 'error') {
      statusAutoDismissRef.current = setTimeout(() => {
        setStatusBanner((current) => {
          if (current?.message === message) {
            return null;
          }
          return current;
        });
        statusAutoDismissRef.current = null;
      }, STATUS_AUTO_DISMISS_MS);
    }
  }, []);

  // Handle incoming events
  const handleEvent = useCallback((e: unknown) => {
    const known = isEvent(e);

    if (known && isConversationStateUpdateEvent(e)) {
      if (e.agent_status) {
        setAgentStatus(e.agent_status);
        if (e.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
          showStatusMessage('warn', 'Agent is waiting for confirmation');
        }
        lastAgentStatusRef.current = e.agent_status;
      }
      return;
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
    if ((e as any)?.kind === 'ConversationStateUpdateEvent') {
      return;
    }

    setEvents((ev) => [...ev, { id: eventId.current++, event: e as any }]);
  }, [showStatusMessage]);

  // Signal webview is ready on mount
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    vscodeApi.postMessage({ type: 'webviewReady' });
  }, []);

  // Message handler
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
              setStatusBanner({ message: 'Local mode active', level: 'info' });
            } else if (payload.status === 'connecting') {
              setStatusBanner({ message: 'Connecting to server…', level: 'info' });
            } else if (payload.status === 'online') {
              setStatusBanner({ message: 'Connected', level: 'info' });
            } else if (payload.status === 'offline') {
              setStatusBanner({ message: 'Disconnected', level: 'warn' });
            }
          }
          break;
        case 'configUpdated':
          if (typeof payload.serverUrl === 'string' || payload.serverUrl === null) {
            const label = payload.serverUrl && payload.serverUrl.length > 0 ? payload.serverUrl : 'local';
            showStatusMessage('info', `Config: ${label}`);
          }
          if (payload.mode === 'local') {
            setMode('local');
            setStatusBanner({ message: 'Local mode active', level: 'info' });
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
          }
          break;
        case 'workspaceFiles':
          if (Array.isArray(payload.files)) {
            setWorkspaceFiles(payload.files.filter((f): f is string => typeof f === 'string'));
            setIsContextLoading(false);
          }
          break;
        case 'skillsList': {
          const payloadSkills = (payload as { skills?: unknown }).skills;
          const entries = Array.isArray(payloadSkills)
            ? payloadSkills.filter(
                (item): item is { label: string; path: string } =>
                  !!item &&
                  typeof item === 'object' &&
                  typeof (item as { label?: unknown }).label === 'string' &&
                  typeof (item as { path?: unknown }).path === 'string'
              )
            : [];
          setSkills(entries);
          setIsSkillsLoading(false);
          setSkillsActiveIndex(0);
          break;
        }
        case 'queryRenderedEvents': {
          const vscodeApi = getVscodeApi();
          vscodeApi.postMessage({
            type: 'renderedEventsResponse',
            count: events.length,
            eventTypes: events.map(e => (e.event as any).kind ?? (e.event as any).type)
          });
          break;
        }
        case 'historyList': {
          const list = Array.isArray(payload.conversations) ? payload.conversations : [];
          setHistory(list);
          setShowHistory(true);
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

  // Filtered workspace files for context picker
  const filteredWorkspaceFiles = useMemo(() => {
    if (!contextQuery.trim()) return workspaceFiles.slice(0, 20);
    const lower = contextQuery.toLowerCase();
    return workspaceFiles.filter((file) => file.toLowerCase().includes(lower)).slice(0, 20);
  }, [contextQuery, workspaceFiles]);

  const safeContextActiveIndex = Math.min(contextActiveIndex, Math.max(0, filteredWorkspaceFiles.length - 1));
  const safeSkillsActiveIndex = Math.min(skillsActiveIndex, Math.max(0, skills.length - 1));

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
    postMessage({ type: 'requestHistory' });
  }, [postMessage]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    selectionRef.current = { start, end };
  }, []);

  const handleInputSelect = useCallback((event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    selectionRef.current = { start, end };
  }, []);

  const insertContextFile = useCallback((file: string) => {
    const { start } = selectionRef.current;
    const before = input.slice(0, start);
    const after = input.slice(start);
    const mention = `@${file} `;
    const newValue = before + mention + after;
    const caretPos = before.length + mention.length;

    if (!selectedContextFiles.includes(file)) {
      setSelectedContextFiles((prev) => [...prev, file]);
    }

    selectionRef.current = { start: caretPos, end: caretPos };
    setInput(newValue);
    setShowContextPicker(false);
    setContextQuery('');
    setContextActiveIndex(0);
    setTimeout(() => {
      const el = document.getElementById('openhands-chat-input');
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.setSelectionRange(caretPos, caretPos);
      }
    }, 0);
  }, [input, selectedContextFiles]);

  const handleContextQueryKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showContextPicker) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredWorkspaceFiles.length === 0) return;
      setContextActiveIndex((prev) => (prev + 1) % filteredWorkspaceFiles.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredWorkspaceFiles.length === 0) return;
      setContextActiveIndex((prev) => (prev - 1 + filteredWorkspaceFiles.length) % filteredWorkspaceFiles.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const file = filteredWorkspaceFiles[safeContextActiveIndex];
      if (file) insertContextFile(file);
    }
  }, [filteredWorkspaceFiles, insertContextFile, safeContextActiveIndex, showContextPicker]);

  const closeContextPicker = useCallback(() => {
    setShowContextPicker(false);
    setContextQuery('');
    setContextActiveIndex(0);
  }, []);

  const closeSkillsPopover = useCallback(() => {
    setShowSkillsPopover(false);
    setSkillsActiveIndex(0);
  }, []);

  const openSkill = useCallback((path: string) => {
    showStatusMessage('info', 'Opening skill…');
    postMessage({ type: 'openSkill', path });
    closeSkillsPopover();
  }, [closeSkillsPopover, postMessage, showStatusMessage]);

  const handleContextToggle = useCallback(() => {
    closeSkillsPopover();
    setShowContextPicker((prev) => {
      const next = !prev;
      if (next) {
        setContextActiveIndex(0);
        if (!workspaceFilesRequested) {
          setWorkspaceFilesRequested(true);
          setIsContextLoading(true);
          postMessage({ type: 'requestWorkspaceFiles' });
        }
      } else {
        setContextQuery('');
        setContextActiveIndex(0);
      }
      return next;
    });
  }, [closeSkillsPopover, postMessage, workspaceFilesRequested]);

  const handleSkillsToggle = useCallback(() => {
    closeContextPicker();
    setShowSkillsPopover((prev) => {
      const next = !prev;
      if (next) {
        setSkillsActiveIndex(0);
        if (!skillsRequested) {
          setSkillsRequested(true);
          setIsSkillsLoading(true);
          postMessage({ type: 'requestSkills' });
        }
      } else {
        setSkillsActiveIndex(0);
      }
      return next;
    });
  }, [closeContextPicker, postMessage, skillsRequested]);

  const handleSkillsKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!showSkillsPopover || skills.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSkillsActiveIndex((prev) => (prev + 1) % skills.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSkillsActiveIndex((prev) => (prev - 1 + skills.length) % skills.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const skill = skills[safeSkillsActiveIndex];
      if (skill) openSkill(skill.path);
    }
  }, [openSkill, safeSkillsActiveIndex, showSkillsPopover, skills]);

  useEffect(() => {
    if (!showContextPicker) return;
    const timer = setTimeout(() => {
      const contextualInput = document.getElementById('openhands-context-query');
      if (contextualInput instanceof HTMLInputElement) contextualInput.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [showContextPicker]);

  useEffect(() => {
    if (!showSkillsPopover) return;
    const timer = setTimeout(() => {
      const target = skillsPopoverRef.current;
      if (!target) return;
      const firstButton = target.querySelector<HTMLButtonElement>('button');
      if (firstButton) {
        firstButton.focus();
      } else {
        target.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [showSkillsPopover, skills.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showContextPicker && contextPopoverRef.current && !contextPopoverRef.current.contains(event.target as Node)) {
        closeContextPicker();
      }
      if (showSkillsPopover && skillsPopoverRef.current && !skillsPopoverRef.current.contains(event.target as Node)) {
        closeSkillsPopover();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showContextPicker) closeContextPicker();
      if (showSkillsPopover) closeSkillsPopover();
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeContextPicker, closeSkillsPopover, showContextPicker, showSkillsPopover]);

  const isLocalMode = mode === 'local';

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    const files = selectedContextFiles.slice();
    let finalText = text;
    if (files.length > 0) {
      const lines = files;
      finalText += `\n\nUser has selected the following files for you to read:\n${lines.join('\n')}`;
    }

    setInput('');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setContextQuery('');
    setSelectedContextFiles([]);
    selectionRef.current = { start: 0, end: 0 };
    postMessage({ type: 'send', text: finalText });
  }, [input, postMessage, selectedContextFiles]);

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

  const handleSelectConversation = useCallback((id: string) => {
    setShowHistory(false);
    postMessage({ type: 'restoreConversation', id });
  }, [postMessage]);

  return (
    <div className="oh-app">
      {/* Animated Background */}
      <div className="oh-app-background" />
      <div className="oh-scan-line" />

      {/* Header / Command Bar */}
      <header className="oh-header">
        <div className="oh-header-left">
          <div className="oh-header-brand">
            <svg className="oh-brand-icon" viewBox="0 0 47 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M44.731 8.9991C43.271 8.13859 42.2956 9.4574 42.4152 11.248L42.4031 11.2616C42.4071 9.39165 42.1435 7.32642 41.2675 5.65567C40.9573 5.06395 40.3287 4.09128 39.0856 4.54957C38.5402 4.75068 38.0454 5.35594 38.3009 6.9184C38.3009 6.9184 38.5848 8.55821 38.532 10.6196V10.6486C38.1772 4.96339 36.8388 3.22883 34.9246 3.34099C34.3122 3.44541 33.4748 3.69873 33.7566 5.44683C33.7566 5.44683 34.0628 7.27034 34.1622 8.72258L34.1683 8.79606H34.1622C33.2618 5.66147 32.0492 5.61893 31.1712 5.74076C30.3743 5.85098 29.5044 6.64381 29.9444 8.20627C31.3253 13.1083 31.0556 19.012 30.9522 19.857C30.6703 19.2789 30.5831 18.8206 30.1918 18.1863C28.6182 15.6396 27.87 15.452 26.9514 15.4133C26.0389 15.3746 25.0534 15.9141 25.1183 16.941C25.1852 17.9678 25.7307 18.1379 26.5053 19.5689C27.1096 20.6827 27.2819 22.1427 28.4986 24.7958C29.5064 26.9925 32.1405 29.402 36.9382 29.1158C40.8255 28.992 46.631 27.6887 45.6212 19.13C45.3697 17.6429 45.5583 16.3976 45.6901 15.1213C45.8949 13.1412 46.195 9.85962 44.733 8.99717L44.731 8.9991Z" fill="#FFE165"/>
              <path d="M20.458 15.4707C19.5395 15.5268 18.7973 15.7259 17.2724 18.2998C16.8932 18.9398 16.8161 19.4 16.5444 19.9821C16.4248 19.139 16.0415 13.2411 17.3272 8.31587C17.7368 6.74761 16.8526 5.97024 16.0537 5.87356C15.1736 5.7672 13.959 5.83101 13.1195 8.99654H13.1094L13.1215 8.90566C13.1925 7.45149 13.4642 5.62411 13.4642 5.62411C13.7096 3.87021 12.8701 3.63236 12.2557 3.5376C10.3455 3.46025 9.04367 5.20255 8.79222 10.8375H8.78817C8.70097 8.79737 8.95039 7.17303 8.95039 7.17303C9.17547 5.60477 8.66853 5.00918 8.119 4.81774C6.86786 4.38071 6.25749 5.36498 5.95941 5.96251C5.11585 7.64873 4.89077 9.71783 4.93133 11.5878L4.91916 11.5742C5.0023 9.78164 4.0026 8.48023 2.55882 9.36589C1.11504 10.2535 1.47802 13.5292 1.72135 15.5055C1.87952 16.7798 2.09041 18.0213 1.86735 19.5122C1.02379 28.0864 6.85366 29.2872 10.7429 29.3433C15.5447 29.5464 18.1322 27.0886 19.0974 24.8745C20.2613 22.202 20.4074 20.7382 20.9893 19.6147C21.7355 18.1702 22.279 17.9904 22.3256 16.9635C22.3723 15.9367 21.3766 15.4146 20.4641 15.4688L20.458 15.4707Z" fill="#FFE165"/>
            </svg>
            <span className="oh-brand-title">OpenHands</span>
          </div>
          {!isLocalMode && (
            <div className="oh-status-badge">
              <span className={`oh-status-dot ${status}`} />
              {status}
            </div>
          )}
          {isLocalMode && (
            <div className="oh-status-badge">
              <span className="codicon codicon-server-environment" />
              LOCAL
            </div>
          )}
        </div>
        <div className="oh-header-right">
          <button
            className="oh-toolbar-btn"
            onClick={handleStartNewConversation}
            title="New Conversation"
            aria-label="New Conversation"
          >
            <span className="codicon codicon-add" />
          </button>
          <button
            className="oh-toolbar-btn"
            onClick={handleOpenHistory}
            title="History"
            aria-label="History"
          >
            <span className="codicon codicon-history" />
          </button>
          <button
            className="oh-toolbar-btn"
            onClick={() => postMessage({ type: 'openSettingsPage' })}
            title="Settings"
            aria-label="Settings"
          >
            <span className="codicon codicon-settings-gear" />
          </button>
          {!isLocalMode && (
            <button
              className={`oh-toolbar-btn ${status === 'connecting' ? 'spinning' : ''}`}
              onClick={() => postMessage({ type: 'command', command: 'reconnect' })}
              title={status === 'online' ? 'Connected (click to reconnect)' : status === 'offline' ? 'Disconnected (click to reconnect)' : 'Reconnecting'}
              aria-label="Connection status"
            >
              <span className={`codicon codicon-${status === 'online' ? 'pass' : status === 'offline' ? 'error' : 'sync'}`} />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="oh-main">
        <div className="oh-timeline-container" role="log" aria-label="Conversation events" aria-live="polite">
          <div className="oh-timeline">
            {events.map((ev) => (
              <EventBlock key={ev.id} event={ev.event} />
            ))}
            {agentStatus === 'WAITING_FOR_CONFIRMATION' && pendingActions.length > 0 && (
              <ConfirmationPrompt
                actions={pendingActions}
                onApprove={handleApprove}
                onReject={handleReject}
                isSubmitting={isSubmitting}
              />
            )}
            <div ref={endRef} />
          </div>
        </div>
      </main>

      {/* Input Area / Command Center */}
      <footer className="oh-input-area">
        <div className="oh-input-wrapper">
          <textarea
            id="openhands-chat-input"
            className="oh-input-field"
            placeholder="Type your message..."
            value={input}
            onChange={handleInputChange}
            onSelect={handleInputSelect}
            onClick={handleInputSelect}
            onFocus={handleInputSelect}
            onKeyUp={handleInputSelect}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
                return;
              }
              handleInputSelect(e);
            }}
            rows={3}
            aria-label="Message input"
          />
        </div>

        <div className="oh-accessories">
          <div className="relative">
            <button
              className="oh-accessory-btn"
              onClick={handleContextToggle}
              title="Add context"
            >
              <span className="codicon codicon-mention" />
              Context
            </button>
            {showContextPicker && (
              <div
                ref={contextPopoverRef}
                className="oh-popover"
                style={{ bottom: '100%', left: 0, marginBottom: '8px', width: '280px' }}
              >
                <div className="oh-popover-title">Add Context</div>
                <input
                  id="openhands-context-query"
                  type="text"
                  value={contextQuery}
                  onChange={(e) => {
                    setContextQuery(e.target.value);
                    setContextActiveIndex(0);
                  }}
                  onKeyDown={handleContextQueryKeyDown}
                  placeholder="Search files..."
                  className="oh-popover-search"
                />
                <div className="oh-popover-list">
                  {isContextLoading ? (
                    <div className="py-2 text-center text-sm opacity-70">Loading…</div>
                  ) : filteredWorkspaceFiles.length === 0 ? (
                    <div className="py-2 text-center text-sm opacity-70">No matches</div>
                  ) : (
                    filteredWorkspaceFiles.map((file, index) => (
                      <div
                        key={file}
                        className={`oh-popover-item ${index === safeContextActiveIndex ? 'active' : ''}`}
                        onClick={() => insertContextFile(file)}
                        onMouseEnter={() => setContextActiveIndex(index)}
                      >
                        <span className="oh-truncate" title={file}>{file}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            className="oh-accessory-btn"
            onClick={() => showStatusMessage('info', 'File attachments coming soon')}
            title="Attach files"
          >
            <span className="codicon codicon-add" />
            Attach
          </button>

          <button
            className="oh-accessory-btn"
            onClick={() => showStatusMessage('info', 'MCP server management coming soon')}
            title="MCP Servers"
          >
            <span className="codicon codicon-server-environment" />
            MCP
          </button>

          <div className="relative">
            <button
              className="oh-accessory-btn"
              onClick={handleSkillsToggle}
              title="Skills"
            >
              <span className="codicon codicon-mortar-board" />
              Skills
            </button>
            {showSkillsPopover && (
              <div
                ref={skillsPopoverRef}
                tabIndex={-1}
                className="oh-popover"
                style={{ bottom: '100%', right: 0, marginBottom: '8px', width: '260px' }}
                onKeyDown={handleSkillsKeyDown}
              >
                <div className="oh-popover-title">Skills</div>
                <div className="oh-popover-list">
                  {isSkillsLoading ? (
                    <div className="py-2 text-center text-sm opacity-70">Loading…</div>
                  ) : skills.length === 0 ? (
                    <div className="py-2 text-center text-sm opacity-70">No skills found</div>
                  ) : (
                    skills.map((skill, index) => (
                      <div
                        key={skill.path}
                        className={`oh-popover-item ${index === safeSkillsActiveIndex ? 'active' : ''}`}
                        onClick={() => openSkill(skill.path)}
                        onMouseEnter={() => setSkillsActiveIndex(index)}
                      >
                        {skill.label}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {statusBanner && (
          <div className={`oh-status-banner ${statusBanner.level}`}>
            <span>{statusBanner.message}</span>
            {conversationId && statusBanner.level !== 'error' && (
              <span className="opacity-60">ID: {conversationId.slice(0, 8)}</span>
            )}
          </div>
        )}
      </footer>

      {/* History Panel */}
      {showHistory && (
        <div className="oh-history-overlay" onClick={() => setShowHistory(false)}>
          <div className="oh-history-panel" onClick={(e) => e.stopPropagation()}>
            <div className="oh-history-header">
              <h3>Conversation History</h3>
              <button onClick={() => setShowHistory(false)} className="oh-toolbar-btn">
                <span className="codicon codicon-close" />
              </button>
            </div>
            <div className="oh-history-list">
              {history.length === 0 ? (
                <div className="py-4 text-center text-sm opacity-70">No conversations yet</div>
              ) : (
                history.map((conv) => (
                  <div
                    key={conv.id}
                    className={`oh-history-item ${conv.id === conversationId ? 'active' : ''}`}
                    onClick={() => handleSelectConversation(conv.id)}
                  >
                    <div className="oh-history-item-title">
                      {conv.title || conv.firstMessage?.slice(0, 50) || 'Untitled'}
                    </div>
                    <div className="oh-history-item-meta">
                      {new Date(conv.timestamp).toLocaleDateString()}
                      {conv.messageCount && ` · ${conv.messageCount} messages`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
