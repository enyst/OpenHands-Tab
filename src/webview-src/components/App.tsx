// React must be in scope for JSX to work after esbuild transpilation
import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessoryButton, ToolbarButton } from './ToolbarButtons';
/*
  App.tsx hygiene improvements:
  - Cache VS Code API once
  - Debounce/suppress toasts
  - Stable keys for messages
  - Enter to send; Shift+Enter newline
  - Deterministic scroll with sentinel
  - A11y roles
*/

import { ToastManager, toasterMessages, Typography, Scrollable, Input } from '@openhands/ui';
import {
  isEvent,
  isTextContent,
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
  type ObservationEvent,
  type MessageEvent as AgentMessageEvent,
  type SystemPromptEvent,
  type UserRejectObservation,
  type AgentErrorEvent,
  type ConversationErrorEvent,
  type PauseEvent,
  type Condensation,
} from 'agent-sdk-ts';

interface VscodeApi {
  postMessage: (message: unknown) => void;
}

// Cache the VS Code API - it can only be acquired once per webview
let vscodeApiInstance: VscodeApi | undefined;

function getVscodeApi(): VscodeApi {
  if (vscodeApiInstance) {
    return vscodeApiInstance;
  }

  if (typeof window !== 'undefined' && 'acquireVsCodeApi' in window && typeof (window as { acquireVsCodeApi?: () => VscodeApi }).acquireVsCodeApi === 'function') {
    vscodeApiInstance = (window as { acquireVsCodeApi: () => VscodeApi }).acquireVsCodeApi();
    return vscodeApiInstance;
  }

  // Fallback for non-vscode environments (e.g., tests)
  vscodeApiInstance = { postMessage: () => { /* noop for tests */ } };
  return vscodeApiInstance;
}

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  const colorClass = status === 'online'
    ? 'bg-[var(--color-green-600)]'
    : status === 'offline'
      ? 'bg-[var(--color-red-600)]'
      : 'bg-[var(--color-primary-500)]';
  return (
    <span
      aria-label={`Connection status: ${status}`}
      className={`inline-block w-[10px] h-[10px] rounded-full mr-2 align-middle ${colorClass}`}
    />
  );
}

type RenderedEvent = { id: number; event: Event };

// Event rendering components based on ConversationVisualizer

function SystemPromptEventBlock({ event }: { event: SystemPromptEvent }) {
  return (
    <div className="bg-[rgba(200,50,200,0.06)] border-l-[3px] border-[rgba(200,50,200,0.6)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-[var(--vscode-foreground)]">System Prompt</div>
      <div className="whitespace-pre-wrap">{event.system_prompt.text}</div>
      {event.tools && event.tools.length > 0 && (
        <div className="mt-2 text-sm opacity-80">
          Tools Available: {event.tools.length}
        </div>
      )}
    </div>
  );
}

function ActionEventBlock({ event }: { event: ActionEvent }) {
  const thought = event.thought.map((t) => t.text).join('\n');
  const isExecuted = event.action !== null;
  return (
    <div className="bg-[rgba(0,120,212,0.06)] border-l-[3px] border-[rgba(0,120,212,0.6)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-[var(--vscode-foreground)]">
        Agent Action{!isExecuted && ' (Not Executed)'}
      </div>
      {event.security_risk && event.security_risk !== 'UNKNOWN' && (
        <div className={`mb-2 px-2 py-1 rounded text-sm ${
          event.security_risk === 'HIGH' ? 'bg-red-500/20 text-red-700' :
          event.security_risk === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-700' :
          'bg-blue-500/20 text-blue-700'
        }`}>
          Security Risk: {event.security_risk}
        </div>
      )}
      {event.reasoning_content && (
        <>
          <div className="font-semibold mt-2">Reasoning:</div>
          <div className="whitespace-pre-wrap">{event.reasoning_content}</div>
        </>
      )}
      {thought && (
        <>
          <div className="font-semibold mt-2">Thought:</div>
          <div className="whitespace-pre-wrap">{thought}</div>
        </>
      )}
      {event.tool_name && (
        <div className="mt-2">
          <span className="font-semibold">Tool: </span>
          <span className="font-mono text-sm px-2 py-1 rounded bg-black/10">{event.tool_name}</span>
        </div>
      )}
      {event.action && (
        <div className="mt-2 font-mono text-sm bg-black/5 p-2 rounded overflow-auto">
          {JSON.stringify(event.action, null, 2)}
        </div>
      )}
    </div>
  );
}

function ObservationEventBlock({ event }: { event: ObservationEvent }) {
  const [expanded, setExpanded] = useState(false);
  const output = JSON.stringify(event.observation, null, 2);
  const tooLong = output.length > 2000;
  const shown = expanded || !tooLong ? output : output.slice(0, 2000) + '\n…';
  return (
    <div className="bg-[rgba(200,150,0,0.06)] border-l-[3px] border-[rgba(200,150,0,0.6)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-[var(--vscode-foreground)]">Observation</div>
      <div className="mb-1">
        <span className="font-semibold">Tool: </span>
        <span className="font-mono text-sm px-2 py-1 rounded bg-black/10">{event.tool_name}</span>
      </div>
      <div className="font-semibold mt-2">Result:</div>
      <div className="whitespace-pre-wrap font-mono text-sm bg-black/5 p-2 rounded mt-1">
        {shown}
      </div>
      {tooLong && (
        <button
          className="text-[var(--vscode-textLink-foreground)] text-sm mt-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function UserRejectBlock({ event }: { event: UserRejectObservation }) {
  return (
    <div className="bg-[rgba(220,0,0,0.08)] border-l-[3px] border-[rgba(220,0,0,0.7)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-red-600">User Rejected Action</div>
      <div className="mb-1">
        <span className="font-semibold">Tool: </span>
        <span className="font-mono text-sm px-2 py-1 rounded bg-black/10">{event.tool_name}</span>
      </div>
      <div className="font-semibold mt-2">Rejection Reason:</div>
      <div className="whitespace-pre-wrap mt-1">{event.rejection_reason}</div>
    </div>
  );
}

function AgentErrorBlock({ event }: { event: AgentErrorEvent }) {
  return (
    <div className="bg-[rgba(220,0,0,0.08)] border-l-[3px] border-[rgba(220,0,0,0.7)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-red-600">Agent Error</div>
      <div className="font-semibold">Error Details:</div>
      <div className="whitespace-pre-wrap mt-1 text-red-700">{event.error}</div>
      {event.tool_name && (
        <div className="mt-2 text-sm opacity-70">Tool: {event.tool_name}</div>
      )}
    </div>
  );
}

function ConversationErrorBlock({ event }: { event: ConversationErrorEvent }) {
  return (
    <div className="bg-[rgba(220,0,0,0.08)] border-l-[3px] border-[rgba(220,0,0,0.7)] p-3 rounded my-1">
      <div className="font-bold mb-2 text-red-600">Conversation Error</div>
      {event.code && (
        <div className="text-sm font-mono mb-2">Code: {event.code}</div>
      )}
      {event.detail && (
        <div className="font-semibold">Details:</div>
      )}
      {event.detail && (
        <div className="whitespace-pre-wrap mt-1 text-red-700">{event.detail}</div>
      )}
      {!event.detail && !event.code && (
        <div className="mt-1 text-sm opacity-70">Additional information unavailable.</div>
      )}
    </div>
  );
}

function PauseEventBlock({ event: _event }: { event: PauseEvent }) {
  return (
    <div className="bg-[rgba(255,200,0,0.1)] border-l-[3px] border-[rgba(255,200,0,0.8)] p-3 rounded my-1">
      <div className="font-bold text-yellow-700">User Paused</div>
      <div className="mt-1 text-sm opacity-80">Conversation Paused</div>
    </div>
  );
}

function CondensationBlock({ event }: { event: Condensation }) {
  return (
    <div className="bg-[rgba(200,50,200,0.06)] border-l-[3px] border-[rgba(200,50,200,0.6)] p-3 rounded my-1">
      <div className="font-bold mb-2">Auto Conversation Condensation Triggered</div>
      <div>Forgetting {event.forgotten_event_ids.length} events</div>
      {event.summary && (
        <>
          <div className="font-semibold mt-2">[Summary of Events Being Forgotten]</div>
          <div className="whitespace-pre-wrap mt-1">{event.summary}</div>
        </>
      )}
    </div>
  );
}

function MessageEventBlock({ event }: { event: AgentMessageEvent }) {
  const role = event.llm_message.role;
  const textParts = event.llm_message.content.filter(isTextContent).map((c) => c.text);
  const content = textParts.join('\n');

  // Extract image content
  const imageParts = event.llm_message.content.filter((c): c is { type: 'image'; image_urls?: string[]; detail?: string } =>
    c.type === 'image'
  );

  const bgClass = role === 'user'
    ? 'bg-[rgba(0,120,212,0.08)] border border-[rgba(0,120,212,0.2)]'
    : role === 'assistant'
      ? 'bg-[rgba(0,200,0,0.06)] border border-[rgba(0,200,0,0.18)]'
      : 'bg-[rgba(128,128,128,0.06)] border border-[rgba(128,128,128,0.2)]';

  return (
    <div className={`${bgClass} p-3 rounded my-1`}>
      <div className="font-semibold mb-2 capitalize">{event.source || role}</div>
      {content && <div className="whitespace-pre-wrap">{content}</div>}
      {imageParts.length > 0 && (
        <div className="mt-2">
          {imageParts.map((img, idx) => (
            <div key={idx} className="text-sm opacity-70">
              📷 Image {img.image_urls && img.image_urls.length > 0 ? `(${img.image_urls.length} url${img.image_urls.length > 1 ? 's' : ''})` : ''}
            </div>
          ))}
        </div>
      )}
      {event.llm_message.reasoning_content && (
        <>
          <div className="font-semibold mt-2">Reasoning:</div>
          <div className="whitespace-pre-wrap mt-1">{event.llm_message.reasoning_content}</div>
        </>
      )}
      {(() => {
        const activated = event.activated_microagents ?? event.activated_skills;
        if (!activated || activated.length === 0) return null;
        const label = event.activated_microagents ? 'Activated Microagents' : 'Activated Skills';
        return (
          <div className="mt-2 text-sm opacity-70">
            {label}: {activated.join(', ')}
          </div>
        );
      })()}
      {event.extended_content && event.extended_content.length > 0 && (
        <>
          <div className="font-semibold mt-2">Prompt Extension based on Agent Context:</div>
          <div className="whitespace-pre-wrap mt-1">{event.extended_content.map(c => c.text).join(' ')}</div>
        </>
      )}
    </div>
  );
}

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 *
 * Supported event types (validated by type guards in agent-sdk.ts):
 * - SystemPromptEvent: Shows system instructions and available tools
 * - ActionEvent: Displays agent's planned action with security risk badges
 * - ObservationEvent: Shows tool execution results (with expand/collapse for long output)
 * - UserRejectObservation: Displays rejection notifications from confirmation mode
 * - MessageEvent: Renders assistant/user messages (text content only)
 * - AgentErrorEvent: Shows error messages with tool context
 * - PauseEvent: Displays pause notifications
 * - Condensation: Shows conversation summarization events
 *
 * Fallback: Unknown event types render as JSON for debugging.
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

  // Fallback for unknown events (should not happen with proper agent-sdk events)
  return (
    <div className="bg-[rgba(128,128,128,0.06)] border-l-[3px] border-[rgba(128,128,128,0.6)] p-3 rounded my-1">
      <div className="font-semibold mb-1">Unknown Event: {event.type}</div>
      <div className="font-mono text-sm overflow-auto">
        {JSON.stringify(event, null, 2)}
      </div>
    </div>
  );
}

const TOAST_DEBOUNCE_MS = 600;
let lastToast = { type: '' as '' | 'info' | 'success' | 'warning' | 'error', at: 0 };
function toastDebounced(type: 'info' | 'success' | 'warning' | 'error', msg: string) {
  const now = Date.now();
  if (lastToast.type === type && now - lastToast.at < TOAST_DEBOUNCE_MS) return;
  lastToast = { type, at: now };
  try {
    const fn = toasterMessages[type];
    if (typeof fn === 'function') fn(msg);
  } catch {
    // no-op if UI toast API is unavailable
  }
}

/**
 * ConfirmationPrompt: displays pending actions awaiting user approval/rejection.
 *
 * Shown when agent_status is WAITING_FOR_CONFIRMATION. Lists each pending action
 * with its tool name, security risk level, and approve/reject buttons.
 */
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
    <div className="bg-[rgba(255,200,0,0.1)] border-l-[3px] border-[rgba(255,200,0,0.8)] p-4 rounded my-2">
      <div className="font-bold mb-3 text-[var(--vscode-foreground)] text-lg">
        ⚠️ Action Confirmation Required
      </div>
      {actions.map((action) => (
        <div key={action.tool_call_id} className="mb-3 pb-3 border-b border-[rgba(128,128,128,0.2)] last:border-b-0">
          <div className="mb-2">
            <span className="font-semibold">Tool: </span>
            <span className="font-mono text-sm px-2 py-1 rounded bg-black/10">{action.tool_name}</span>
            {action.security_risk && action.security_risk !== 'UNKNOWN' && (
              <span className={`ml-2 px-2 py-1 rounded text-xs font-semibold ${
                action.security_risk === 'HIGH' ? 'bg-red-100 text-red-800' :
                action.security_risk === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                'bg-green-100 text-green-800'
              }`}>
                Risk: {action.security_risk}
              </span>
            )}
          </div>
          {action.thought && action.thought.length > 0 && (
            <div className="mb-2">
              <div className="text-sm font-semibold">Thought:</div>
              <div className="text-sm whitespace-pre-wrap mt-1">
                {action.thought.map(t => t.text).join('\n')}
              </div>
            </div>
          )}
          {action.action && (
            <div className="mb-2">
              <div className="text-sm font-semibold">Action Details:</div>
              <div className="font-mono text-xs bg-black/5 p-2 rounded mt-1 overflow-auto max-h-32">
                {JSON.stringify(action.action, null, 2)}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2 items-center mt-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="px-3 py-1.5 rounded text-sm font-medium border-0 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)'
          }}
        >
          ✓ Approve
        </button>
        {!showRejectInput ? (
          <button
            type="button"
            onClick={() => setShowRejectInput(true)}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded text-sm font-medium border-0 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)'
            }}
          >
            ✗ Reject
          </button>
        ) : (
          <>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={isSubmitting}
              placeholder="Reason for rejection (optional)"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
              style={{ background: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)', borderColor: 'var(--vscode-input-border)' }}
            />
            <button
              type="button"
              onClick={handleReject}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded text-sm font-medium border-0 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)'
              }}
            >
              Confirm Reject
            </button>
            <button
              type="button"
              onClick={() => setShowRejectInput(false)}
              disabled={isSubmitting}
              className="px-3 py-1.5 rounded text-sm font-medium border-0 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)'
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Main App component: React webview root for OpenHands extension.
 *
 * Architecture:
 * - Receives messages from extension host via window.postMessage
 * - Renders agent-sdk events in a scrollable message stream
 * - Sends user input and commands back to extension via vscode.postMessage
 *
 * State management:
 * - status: Connection state (online/offline/connecting)
 * - events: Array of rendered events with stable keys for React reconciliation
 *
 * Message flow:
 * Extension → Webview: status updates, agent events, errors, config changes
 * Webview → Extension: user messages, commands (pause/reconnect/newConversation)
 */
export function App() {
  const [status, setStatus] = useState<'online' | 'offline' | 'connecting'>('offline');
  const [events, setEvents] = useState<RenderedEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [pendingActions, setPendingActions] = useState<ActionEvent[]>([]);
  const eventId = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [workspaceFilesRequested, setWorkspaceFilesRequested] = useState(false);
  const [contextActiveIndex, setContextActiveIndex] = useState(0);
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);
  const [isSkillsLoading, setIsSkillsLoading] = useState(false);
  const [skillsRequested, setSkillsRequested] = useState(false);
  const [skillsActiveIndex, setSkillsActiveIndex] = useState(0);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [statusBanner, setStatusBanner] = useState<{ message: string; level: 'info' | 'warn' | 'error' } | null>({ message: 'Initializing…', level: 'info' });
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPopoverRef = useRef<HTMLDivElement | null>(null);
  const skillsPopoverRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Define callback functions before useEffects that depend on them
  const handleEvent = useCallback((e: unknown) => {
    if (!isEvent(e)) return;

    // Track agent status from ConversationStateUpdateEvent
    if (isConversationStateUpdateEvent(e)) {
      if (e.agent_status) {
        setAgentStatus(e.agent_status);
        // Show toast only when transitioning INTO confirmation mode (not on repeated updates)
        if (e.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
          toastDebounced('warning', 'Agent is waiting for confirmation');
        }
        lastAgentStatusRef.current = e.agent_status;
      }
      // Don't render state update events in the UI
      return;
    }

    // Track pending actions (actions awaiting confirmation or execution)
    // Deduplicate by tool_call_id to prevent duplicate cards on reconnection or retries
    if (isActionEvent(e)) {
      setPendingActions((prev) => {
        const exists = prev.some((a) => a.tool_call_id === e.tool_call_id);
        return exists ? prev : [...prev, e];
      });
    }

    // Clear pending action when we receive its observation
    // Also reset in-flight flag to allow new confirmations
    if (isObservationEvent(e) || isUserRejectObservation(e)) {
      setPendingActions((prev) => prev.filter((a) => a.tool_call_id !== e.tool_call_id));
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    }

    // Show toast notifications for certain events
    if (isAgentErrorEvent(e)) {
      toastDebounced('error', e.error);
      // Reset in-flight flag on error to allow recovery
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    } else if (isPauseEvent(e)) {
      toastDebounced('warning', 'Conversation paused');
    }

    // Add event to the list for rendering
    setEvents((ev) => [...ev, { id: eventId.current++, event: e }]);
  }, []);

  // Signal webview is ready on mount
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    vscodeApi.postMessage({ type: 'webviewReady' });
  }, []);

  // Message handler: processes incoming messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload = event.data as { type?: string; status?: 'online' | 'offline' | 'connecting'; serverUrl?: string; event?: unknown; error?: unknown };

      switch (payload?.type) {
        case 'status':
          if (payload.status) {
            setStatus(payload.status);
            if (payload.status === 'connecting') {
              setStatusBanner({ message: 'Connecting to server…', level: 'info' });
            } else if (payload.status === 'online') {
              setStatusBanner({ message: 'Connected to server', level: 'info' });
            } else if (payload.status === 'offline') {
              setStatusBanner({ message: 'Disconnected from server', level: 'warn' });
            }
          }
          break;
        case 'configUpdated':
          if (typeof payload.serverUrl === 'string') {
            toastDebounced('info', `Config updated: ${payload.serverUrl}`);
          }
          break;
        case 'event':
          handleEvent(payload.event);
          break;
        case 'error':
          if (typeof payload.error === 'string') {
            setStatusBanner({ message: payload.error, level: 'error' });
            toastDebounced('error', payload.error);
          } else {
            setStatusBanner({ message: 'An unknown error occurred', level: 'error' });
            toastDebounced('error', String(payload.error));
          }
          break;
        case 'conversationStarted': {
          const id = (payload as { conversationId?: unknown }).conversationId;
          if (typeof id === 'string') {
            setConversationId(id);
            setEvents([]);
            setPendingActions([]);
            setAgentStatus(undefined);
            eventId.current = 1;
            setStatusBanner({ message: 'New conversation started', level: 'info' });
          }
          break;
        }
        case 'workspaceFiles': {
          const files = Array.isArray((payload as { files?: unknown }).files)
            ? (payload as { files: unknown[] }).files.filter((f): f is string => typeof f === 'string')
            : [];
          setWorkspaceFiles(files);
          setIsContextLoading(false);
          setContextActiveIndex(0);
          break;
        }
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
          // Respond with rendered event information for testing
          const vscodeApi = getVscodeApi();
          vscodeApi.postMessage({
            type: 'renderedEventsResponse',
            count: events.length,
            eventTypes: events.map(e => e.event.type)
          });
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [events, handleEvent]);

  useEffect(() => {
    // Deterministic scroll to bottom when events change
    const el = endRef.current;
    if (el && 'scrollIntoView' in el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length]);

  const postMessage = useCallback((msg: unknown) => {
    // Acquire live VS Code API on each call so tests that set window.acquireVsCodeApi late still work
    const api = getVscodeApi();
    api.postMessage(msg);
  }, []);

  const [input, setInput] = useState('');

  const handleStartNewConversation = () => {
    setStatusBanner({ message: 'Starting new conversation…', level: 'info' });
    setConversationId(undefined);
    setEvents([]);
    setPendingActions([]);
    setAgentStatus(undefined);
    eventId.current = 1;
    setInput('');
    postMessage({ type: 'command', command: 'startNewConversation' });
  };
  const filteredWorkspaceFiles = useMemo(() => {
    if (!contextQuery.trim()) return workspaceFiles.slice(0, 20);
    const lower = contextQuery.toLowerCase();
    return workspaceFiles.filter((file) => file.toLowerCase().includes(lower)).slice(0, 20);
  }, [contextQuery, workspaceFiles]);

  const safeContextActiveIndex = filteredWorkspaceFiles.length === 0
    ? 0
    : Math.min(contextActiveIndex, filteredWorkspaceFiles.length - 1);
  const safeSkillsActiveIndex = skills.length === 0
    ? 0
    : Math.min(skillsActiveIndex, skills.length - 1);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInput(value);
    const start = event.target.selectionStart ?? value.length;
    const end = event.target.selectionEnd ?? start;
    selectionRef.current = { start, end };
  }, []);

  const handleInputSelect = useCallback((event: React.SyntheticEvent<HTMLInputElement>) => {
    const target = event.target as HTMLInputElement;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    selectionRef.current = { start, end };
  }, []);

  const insertContextFile = useCallback((file: string) => {
    const current = input;
    const { start, end } = selectionRef.current;
    const safeStart = Math.min(start, current.length);
    const safeEnd = Math.min(end, current.length);
    const beforeCursor = current.slice(0, safeStart);
    const afterCursor = current.slice(safeEnd);
    const needsLeadingSpace = beforeCursor.length > 0 && !/\s$/.test(beforeCursor);
    const before = needsLeadingSpace ? `${beforeCursor} ` : beforeCursor;
    const mention = `@${file}`;
    const needsTrailingSpace = afterCursor.length === 0 || !/^\s/.test(afterCursor);
    const after = needsTrailingSpace ? ` ${afterCursor}` : afterCursor;
    const newValue = `${before}${mention}${after}`;
    const caretPos = before.length + mention.length + (needsTrailingSpace ? 1 : 0);

    selectionRef.current = { start: caretPos, end: caretPos };
    setInput(newValue);
    setShowContextPicker(false);
    setContextQuery('');
    setContextActiveIndex(0);
    setTimeout(() => {
      const el = document.getElementById('openhands-chat-input');
      if (el instanceof HTMLInputElement) {
        el.focus();
        el.setSelectionRange(caretPos, caretPos);
      }
    }, 0);
  }, [input]);

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
    toastDebounced('info', 'Opening skill…');
    postMessage({ type: 'openSkill', path });
    closeSkillsPopover();
  }, [closeSkillsPopover, postMessage]);

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

  const connectionIcon = status === 'online' ? 'pass' : status === 'offline' ? 'error' : 'sync';
  const connectionStatusClass = status === 'online'
    ? 'bg-[var(--vscode-testing-iconPassed)]'
    : status === 'offline'
      ? 'bg-[var(--vscode-errorForeground)]'
      : 'bg-[var(--vscode-testing-iconQueued)]';
  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    // Send message and let the server echo it back to avoid duplicates
    setInput('');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setContextQuery('');
    setContextActiveIndex(0);
    setSkillsActiveIndex(0);
    selectionRef.current = { start: 0, end: 0 };
    postMessage({ type: 'send', text });
  }, [input, postMessage]);

  const handleApprove = useCallback(() => {
    // Prevent double-submit: return early if confirmation already in flight
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Set 30-second timeout to prevent permanent lockout if backend doesn't respond
    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      toastDebounced('warning', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'approveAction' });
    // Use "submitted" (pending state) instead of "approved" (implies success)
    toastDebounced('info', 'Approval submitted');
    // Server will send ObservationEvent which clears pending actions and resets flag via handleEvent
  }, [isSubmitting, postMessage]);

  const handleReject = useCallback((reason?: string) => {
    // Prevent double-submit: return early if confirmation already in flight
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Set 30-second timeout to prevent permanent lockout if backend doesn't respond
    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      toastDebounced('warning', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'rejectAction', reason });
    // Use "submitted" (pending state) instead of "rejected" (implies success)
    toastDebounced('info', 'Rejection submitted');
    // Server will send UserRejectObservation which clears pending actions and resets flag via handleEvent
  }, [isSubmitting, postMessage]);

const statusLevelClasses: Record<'info' | 'warn' | 'error', string> = {
  info: 'text-[color-mix(in_srgb,var(--vscode-tab-activeForeground)_85%,transparent)]',
  warn: 'text-[color-mix(in_srgb,var(--vscode-editorWarning-foreground)_90%,transparent)]',
  error: 'text-[color-mix(in_srgb,var(--vscode-editorError-foreground)_95%,transparent)]'
};

  return (
    <div id="app" className="flex flex-col h-screen">
      <ToastManager />
      <header className="flex items-center gap-2 px-3 py-2 border-b border-black/10">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <Typography.H2 className="text-[17px]">OpenHands</Typography.H2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ToolbarButton
            icon="add"
            label="New Conversation"
            onClick={handleStartNewConversation}
          />
          <ToolbarButton
            icon="history"
            label="History"
            onClick={() => toastDebounced('info', 'History view coming soon')}
          />
          <ToolbarButton
            icon="settings-gear"
            label="Settings"
            onClick={() => postMessage({ type: 'openSettingsPage' })}
          />
          <ToolbarButton
            icon={connectionIcon}
            iconClassName={status === 'connecting' ? 'animate-spin' : ''}
            label={status === 'online' ? 'Connected (click to reconnect)' : status === 'offline' ? 'Disconnected (click to reconnect)' : 'Reconnecting'}
            onClick={() => postMessage({ type: 'command', command: 'reconnect' })}
            statusClassName={connectionStatusClass}
          />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 px-3 py-2">
        <Scrollable
          mode="auto"
          type="vertical"
          className="flex-1 min-h-0 rounded border border-black/10 p-2"
          tabIndex={0}
          aria-label="Conversation events"
          role="log"
          aria-live="polite"
        >
          {events.map((ev) => (
            <div key={ev.id}>
              <EventBlock event={ev.event} />
            </div>
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
        </Scrollable>
      </div>

      <div className="flex flex-col gap-3 px-3 py-2 border-t border-black/10">
        <Input
          id="openhands-chat-input"
          label="Message"
          placeholder="Type a message..."
          value={input}
          onChange={handleInputChange}
          onSelect={handleInputSelect}
          onClick={handleInputSelect}
          onFocus={handleInputSelect}
          onKeyUp={handleInputSelect}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
              return;
            }
            handleInputSelect(e);
          }}
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          <div className="relative">
            <AccessoryButton icon="mention" label="Add context" onClick={handleContextToggle} />
            {showContextPicker && (
              <div
                ref={contextPopoverRef}
                className="absolute bottom-full left-0 mb-2 w-72 rounded border border-black/10 bg-[var(--vscode-editor-background)] shadow-lg p-2 z-20"
              >
                <input
                  id="openhands-context-query"
                  type="text"
                  value={contextQuery}
                  onChange={(e) => {
                    setContextQuery(e.target.value);
                    setContextActiveIndex(0);
                  }}
                  onKeyDown={handleContextQueryKeyDown}
                  placeholder="Search workspace files"
                  className="w-full rounded border border-black/15 bg-[var(--vscode-input-background)] px-2 py-1 text-sm"
                />
                <div className="mt-2 max-h-48 overflow-auto">
                  {isContextLoading ? (
                    <div className="py-2 text-center text-sm opacity-70">Loading…</div>
                  ) : filteredWorkspaceFiles.length === 0 ? (
                    <div className="py-2 text-center text-sm opacity-70">No matches</div>
                  ) : (
                    <ul className="space-y-1" role="listbox" aria-label="Workspace files">
                      {filteredWorkspaceFiles.map((file, index) => {
                        const isActive = index === safeContextActiveIndex;
                        return (
                          <li key={file}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_40%,transparent)] ${isActive ? 'bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_50%,transparent)]' : ''}`}
                              onClick={() => insertContextFile(file)}
                              onMouseEnter={() => setContextActiveIndex(index)}
                              onFocus={() => setContextActiveIndex(index)}
                            >
                              <span className="truncate" title={file}>{file}</span>
                              <span className="codicon codicon-pass" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <AccessoryButton
            icon="add"
            label="Attach files"
            onClick={() => toastDebounced('info', 'File attachments coming soon')}
          />
          <AccessoryButton
            icon="server-environment"
            label="MCP Servers"
            onClick={() => toastDebounced('info', 'MCP server management coming soon')}
          />
          <div className="relative">
            <AccessoryButton icon="mortar-board" label="Skills" onClick={handleSkillsToggle} />
            {showSkillsPopover && (
              <div
                ref={skillsPopoverRef}
                tabIndex={-1}
                className="absolute bottom-full right-0 mb-2 w-64 rounded border border-black/10 bg-[var(--vscode-editor-background)] shadow-lg p-2 z-20 focus:outline-none"
                onKeyDown={handleSkillsKeyDown}
              >
                <div className="mb-2 text-sm font-medium">Skills</div>
                <div className="max-h-48 overflow-auto">
                  {isSkillsLoading ? (
                    <div className="py-2 text-center text-sm opacity-70">Loading…</div>
                  ) : skills.length === 0 ? (
                    <div className="py-2 text-center text-sm opacity-70">No skills found</div>
                  ) : (
                    <ul className="space-y-1" role="listbox" aria-label="Skills">
                      {skills.map((skill, index) => {
                        const isActive = index === safeSkillsActiveIndex;
                        return (
                          <li key={skill.path}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_40%,transparent)] ${isActive ? 'bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_50%,transparent)]' : ''}`}
                              onClick={() => openSkill(skill.path)}
                              onMouseEnter={() => setSkillsActiveIndex(index)}
                              onFocus={() => setSkillsActiveIndex(index)}
                            >
                              {skill.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {statusBanner && (
          <div
            className={`mt-2 flex min-h-[22px] items-center gap-2 border-t border-[color-mix(in_srgb,var(--vscode-input-border)_30%,transparent)] pt-2 text-xs ${statusLevelClasses[statusBanner.level]}`}
          >
            <span className="font-semibold">{statusBanner.message}</span>
            {conversationId && statusBanner.level !== 'error' && (
              <span className="opacity-60">Conversation: {conversationId.slice(0, 8)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
