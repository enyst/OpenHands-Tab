import { useEffect, useRef, useState } from 'react';
/*
  App.tsx hygiene improvements:
  - Cache VS Code API once
  - Debounce/suppress toasts
  - Stable keys for messages
  - Enter to send; Shift+Enter newline
  - Deterministic scroll with sentinel
  - A11y roles
*/

import { ToastManager, toasterMessages, Button, Typography, Scrollable, Input } from '@openhands/ui';
import {
  isEvent,
  isTextContent,
  isSystemPromptEvent,
  isActionEvent,
  isObservationEvent,
  isUserRejectObservation,
  isMessageEvent,
  isAgentErrorEvent,
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
  type PauseEvent,
  type Condensation,
} from '../../types/agent-sdk';

function getVscodeApi() {
  if (typeof window !== 'undefined' && (window as any).acquireVsCodeApi) {
    return (window as any).acquireVsCodeApi();
  }
  return { postMessage: (_: any) => {} };
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

function PauseEventBlock({ event }: { event: PauseEvent }) {
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
      {event.activated_microagents && event.activated_microagents.length > 0 && (
        <div className="mt-2 text-sm opacity-70">
          Activated Microagents: {event.activated_microagents.join(', ')}
        </div>
      )}
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
  const lastStatusRef = useRef<'online' | 'offline' | 'connecting' | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Message handler: processes incoming messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload: any = (event as any).data;
      if (payload?.type === 'status') setStatus(payload.status);
      if (payload?.type === 'configUpdated') toastDebounced('info', `Config updated: ${payload.serverUrl}`);
      if (payload?.type === 'event') handleEvent(payload.event);
      if (payload?.type === 'error') toastDebounced('error', String(payload.error));
      if (payload?.type === 'queryRenderedEvents') {
        // Respond with rendered event information for testing
        const vscodeApi = getVscodeApi();
        vscodeApi.postMessage({
          type: 'renderedEventsResponse',
          count: events.length,
          eventTypes: events.map(e => e.event.type)
        });
      }
    };
    window.addEventListener('message', handler as any);
    return () => window.removeEventListener('message', handler as any);
  }, [events]);

  useEffect(() => {
    // Suppress initial toast; debounce subsequent status changes
    if (lastStatusRef.current === null) {
      lastStatusRef.current = status;
      return;
    }
    if (status === 'connecting') toastDebounced('info', 'Connecting...');
    if (status === 'online') toastDebounced('success', 'Connected to server');
    if (status === 'offline') toastDebounced('warning', 'Disconnected');
    lastStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    // Deterministic scroll to bottom when events change
    const el = endRef.current as any;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length]);

  function handleEvent(e: unknown) {
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
  }

  function postMessage(msg: any) {
    // Acquire live VS Code API on each call so tests that set window.acquireVsCodeApi late still work
    const api = getVscodeApi();
    api.postMessage(msg);
  }

  const [input, setInput] = useState('');
  const send = () => {
    const text = input.trim();
    if (!text) return;
    // Send message and let the server echo it back to avoid duplicates
    setInput('');
    postMessage({ type: 'send', text });
  };

  const handleApprove = () => {
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
  };

  const handleReject = (reason?: string) => {
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
  };

  return (
    <div id="app" className="flex flex-col h-screen">
      <ToastManager />
      <header className="flex items-center gap-2 px-3 py-2 border-b border-black/10">
        <StatusDot status={status} />
        <Typography.H1>OpenHands</Typography.H1>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => { toastDebounced('info', 'Opening settings...'); postMessage({ type: 'openSettings' }); }}>Settings</Button>
          <Button onClick={() => { toastDebounced('info', 'Reconnecting...'); postMessage({ type: 'command', command: 'reconnect' }); }}>Reconnect</Button>
          <Button onClick={() => { toastDebounced('info', 'Starting new conversation...'); postMessage({ type: 'command', command: 'startNewConversation' }); }}>New Chat</Button>
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

      <div className="flex items-center gap-2 px-3 py-2 border-t border-black/10">
        <Input
          label="Message"
          placeholder="Type a message..."
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button id="sendBtn" onClick={send}>Send</Button>
          <Button id="stopBtn" variant="secondary" onClick={() => postMessage({ type: 'command', command: 'pause' })}>Stop</Button>
        </div>
      </div>
    </div>
  );
}
