/**
 * EventBlock.tsx - Render components for agent SDK events
 *
 * This file provides React components for rendering various event types from
 * the OpenHands agent conversation:
 *
 * - SystemPromptEventBlock: Initial system instructions
 * - ActionEventBlock: Agent tool invocations (file_editor, terminal)
 * - ObservationEventBlock: Tool execution results
 * - MessageEventBlock: User and agent chat messages
 * - UserRejectBlock: When user rejects an action
 * - AgentErrorBlock / ConversationErrorBlock: Error displays
 * - CondensationBlock: Conversation summarization events
 * - StreamingMessageBlock: Live LLM response streaming
 */

import { useState } from 'react';
import {
  type ActionEvent,
  type ObservationEvent,
  type MessageEvent as AgentMessageEvent,
  type SystemPromptEvent,
  type UserRejectObservation,
  type AgentErrorEvent,
  type ConversationErrorEvent,
  type Condensation,
  isTextContent,
} from '@openhands/agent-sdk-ts';
import { getVscodeApi } from '../shared/vscodeApi';

// ============================================================================
// Type Definitions
// ============================================================================

type FileEditorCommand = 'view' | 'create' | 'str_replace' | 'insert';
type JsonRecord = Record<string, unknown>;
type LineRange = [number, number];

// ============================================================================
// Utility Functions
// ============================================================================

const isFileEditorCommand = (value: unknown): value is FileEditorCommand =>
  value === 'view' || value === 'create' || value === 'str_replace' || value === 'insert';

const getString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const getNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

const isLineRangeTuple = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2;

const parseLineRange = (value: unknown): LineRange | undefined => {
  if (!isLineRangeTuple(value)) return undefined;
  const [start, end] = value;
  if (typeof start !== 'number' || typeof end !== 'number') return undefined;
  return [start, end];
};

const getBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const getCharCount = (value: unknown): number | undefined => (typeof value === 'string' ? value.length : undefined);

const formatLineRange = (range?: LineRange): string | undefined => {
  if (!range) return undefined;
  const [start, end] = range;
  if (start <= 0) return undefined;
  if (end === -1) return 'lines ' + start.toLocaleString() + '–end';
  if (end === start) return 'line ' + start.toLocaleString();
  return 'lines ' + start.toLocaleString() + '–' + end.toLocaleString();
};

const formatCharCount = (count?: number): string | undefined => {
  if (count === undefined) return undefined;
  const unit = count === 1 ? 'character' : 'characters';
  return count.toLocaleString() + ' ' + unit;
};

const formatSizeDelta = (previous?: number, next?: number): string | undefined => {
  if (previous === undefined || next === undefined) return undefined;
  const delta = next - previous;
  if (delta === 0) return 'File size unchanged.';
  const unit = Math.abs(delta) === 1 ? 'character' : 'characters';
  const sign = delta > 0 ? '+' : '';
  return 'File size changed by ' + sign + delta.toLocaleString() + ' ' + unit + '.';
};

const openWorkspaceFile = (path: string) => {
  const api = getVscodeApi();
  api.postMessage({ type: 'openWorkspaceFile', path });
};

function InlineFileReference({ path }: { path?: string }) {
  if (!path) {
    return <span className="font-mono text-xs text-stone-400">this path</span>;
  }
  return (
    <button
      type="button"
      onClick={() => openWorkspaceFile(path)}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.1] text-xs font-mono text-brand-300 align-middle max-w-full transition-all duration-150 group"
      aria-label={`Open ${path}`}
      title={`Open ${path}`}
    >
      <span className="codicon codicon-file text-brand-400/70" />
      <span className="truncate max-w-[16rem]">{path}</span>
      <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
    </button>
  );
}

const TerminalCommandPreview = ({ command }: { command?: string }): React.ReactElement | null => {
  if (!command) return null;
  return (
    <pre className="text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto text-stone-300">
      <span className="text-teal-400/70 select-none">$ </span>{command}
    </pre>
  );
};

// ============================================================================
// Tool Action/Observation Summaries
// ============================================================================

/** Renders human-readable summary for file_editor actions */
function FileEditorActionSummary({ action }: { action: JsonRecord | null }): React.ReactElement | null {
  if (!action) return null;
  const command = getString(action.command);
  if (!isFileEditorCommand(command)) return null;
  const path = getString(action.path);

  switch (command) {
    case 'view': {
      const rangeText = formatLineRange(parseLineRange(action.view_range));
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            The agent wants to read{' '}
            <InlineFileReference path={path} />.
          </p>
          {rangeText && <p className="text-xs opacity-70">Requested {rangeText}.</p>}
        </div>
      );
    }
    case 'create': {
      const planned = formatCharCount(getCharCount(action.file_text));
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            The agent wants to create{' '}
            <InlineFileReference path={path} />.
          </p>
          {planned && <p className="text-xs opacity-70">They plan to write {planned}.</p>}
        </div>
      );
    }
    case 'insert': {
      const planned = formatCharCount(getCharCount(action.new_str));
      const insertLine = getNumber(action.insert_line);
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            The agent wants to insert text into{' '}
            <InlineFileReference path={path} />
            {typeof insertLine === 'number' && (
              <>
                {' '}
                {insertLine === 0 ? 'at the top of the file' : `after line ${insertLine.toLocaleString()}`}
              </>
            )}
            .
          </p>
          {planned && <p className="text-xs opacity-70">They plan to insert {planned}.</p>}
        </div>
      );
    }
    case 'str_replace': {
      const removed = getCharCount(action.old_str);
      const replacementLength = getCharCount(action.new_str) ?? 0;
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            The agent wants to replace text inside{' '}
            <InlineFileReference path={path} />.
          </p>
          {removed !== undefined && (
            <p className="text-xs opacity-70">
              Replacing {formatCharCount(removed)} with {formatCharCount(replacementLength)}.
            </p>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function FileEditorObservationSummary({ observation }: { observation: JsonRecord }): React.ReactElement | null {
  const command = getString(observation.command);
  if (!isFileEditorCommand(command)) return null;
  const path = getString(observation.path);
  const prevExist = getBoolean(observation.prev_exist);
  const rawOld = observation.old_content;
  const rawNew = observation.new_content;
  const oldLength = typeof rawOld === 'string' ? rawOld.length : undefined;
  const newLength = typeof rawNew === 'string' ? rawNew.length : undefined;

  switch (command) {
    case 'view': {
      const listedDirectory = rawOld === null && typeof rawNew === 'string';
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            Agent {listedDirectory ? 'listed the contents of' : 'read'}{' '}
            <InlineFileReference path={path} />.
          </p>
        </div>
      );
    }
    case 'create': {
      const sizeText = formatCharCount(newLength);
      const verb = prevExist === true ? 'overwrote' : 'created';
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            Agent {verb}{' '}
            <InlineFileReference path={path} />.
          </p>
          {sizeText && <p className="text-xs opacity-70">File now contains {sizeText}.</p>}
        </div>
      );
    }
    case 'insert':
    case 'str_replace': {
      const detail = formatSizeDelta(oldLength, newLength);
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>
            Agent {command === 'insert' ? 'inserted text into' : 'replaced text in'}{' '}
            <InlineFileReference path={path} />.
          </p>
          {detail && <p className="text-xs opacity-70">{detail}</p>}
        </div>
      );
    }
    default:
      return null;
  }
}

function TerminalActionSummary({ action }: { action: JsonRecord | null }): React.ReactElement | null {
  if (!action) return null;
  const command = getString(action.command);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to execute a terminal command.</p>
      <TerminalCommandPreview command={command} />
    </div>
  );
}

function TerminalObservationSummary({ observation }: { observation: JsonRecord }): React.ReactElement | null {
  const exitCodeNumber = getNumber(observation.exit_code);
  const exitCodeText = exitCodeNumber !== undefined ? exitCodeNumber.toString() : getString(observation.exit_code) ?? 'unknown';
  const command = getString(observation.command);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The terminal command finished with code {exitCodeText}.</p>
      <TerminalCommandPreview command={command} />
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

/**
 * Event color tokens - CSS custom properties defined in tailwind.css
 * Design Philosophy: "Warm Technical Refinement"
 * - Agent/AI: Warm gold (protagonist, signature OpenHands color)
 * - User: Warm slate (supporting role, understated)
 * - System: Soft lavender (informational)
 * - Action: Teal (operational, cool accent for contrast)
 * - Observation: Soft mint (results/completion)
 * - Error: Warm coral (alerting without harshness)
 */
const USER_ACCENT_COLOR = 'var(--event-user)';
const AGENT_ACCENT_COLOR = 'var(--event-agent)';
const DEFAULT_ACCENT_COLOR = 'var(--event-default)';
const ERROR_ACCENT_COLOR = 'var(--event-error)';
const SYSTEM_ACCENT_COLOR = 'var(--event-system)';
const ACTION_ACCENT_COLOR = 'var(--event-action)';
const OBSERVATION_ACCENT_COLOR = 'var(--event-observation)';

/** Mix a CSS color with transparency - use instead of appending hex alpha to CSS vars */
const withAlpha = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

// Security risk badge component with refined styling
function SecurityBadge({ risk }: { risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' }) {
  const styles = {
    HIGH: 'bg-red-500/15 text-red-300 border-red-400/30 shadow-[0_0_8px_rgba(248,113,113,0.15)]',
    MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    LOW: 'bg-teal-500/15 text-teal-300 border-teal-400/30',
    UNKNOWN: 'bg-stone-500/15 text-stone-400 border-stone-400/20',
  };

  const icons = {
    HIGH: 'shield',
    MEDIUM: 'warning',
    LOW: 'info',
    UNKNOWN: 'question',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${styles[risk]}`}>
      <span className={`codicon codicon-${icons[risk]} text-[10px]`} />
      {risk}
    </span>
  );
}

/**
 * Base event container with accent bar and refined styling.
 * Uses warm gradients and subtle shadows for depth.
 */
function EventContainer({
  children,
  accentColor,
  bgOpacity = 0.04,
  className = '',
  index = 0,
  dataTestId,
}: {
  children: React.ReactNode;
  accentColor: string;
  bgOpacity?: number;
  className?: string;
  index?: number;
  dataTestId?: string;
}) {
  const animationDelay = `${index * 40}ms`;
  const bgOpacityPercent = Math.round(bgOpacity * 100);

  return (
    <div
      data-testid={dataTestId}
      className={`
        relative rounded-xl p-4 my-3
        border-l-[3px] border-r border-t border-b border-r-white/[0.04] border-t-white/[0.04] border-b-white/[0.02]
        shadow-event transition-all duration-200
        hover:shadow-event-hover hover:border-r-white/[0.06]
        animate-slide-up
        ${className}
      `}
      style={{
        borderLeftColor: accentColor,
        background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} ${bgOpacityPercent}%, transparent) 0%, color-mix(in srgb, ${accentColor} ${Math.round(bgOpacity * 50)}%, transparent) 100%)`,
        animationDelay,
      }}
    >
      {/* Subtle top highlight for depth */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${withAlpha(accentColor, 12)}, transparent 50%)` }}
      />
      {children}
    </div>
  );
}

// ============================================================================
// Event Block Components
// ============================================================================

/**
 * Renders system prompt - expandable view of initial agent instructions.
 */
export function SystemPromptEventBlock({ event, index }: { event: SystemPromptEvent; index?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleLabel = isExpanded ? 'Hide system prompt' : 'Show system prompt';

  return (
    <EventContainer accentColor={SYSTEM_ACCENT_COLOR} bgOpacity={0.03} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(SYSTEM_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-gear text-sm" style={{ color: SYSTEM_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">System Prompt</div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.05]"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
          <span>{isExpanded ? 'Hide' : 'Show'}</span>
        </button>
      </div>
      {isExpanded && (
        <>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300 font-mono bg-black/20 rounded-lg p-3 border border-white/[0.04]">
            {event.system_prompt.text}
          </div>
          {event.tools && event.tools.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-stone-400 flex items-center gap-2">
              <span className="codicon codicon-tools" style={{ color: SYSTEM_ACCENT_COLOR }} />
              <span>{event.tools.length} tools available</span>
            </div>
          )}
        </>
      )}
    </EventContainer>
  );
}

/**
 * Renders agent action - shows thought process, tool invocation, and security risk.
 */
export function ActionEventBlock({ event, index }: { event: ActionEvent; index?: number }) {
  const thought = event.thought.map((t) => t.text).join('\n');
  const isExecuted = event.action !== null;
  const [isExpanded, setIsExpanded] = useState(false);
  const actionSummary = isExecuted
    ? event.tool_name === 'file_editor'
      ? <FileEditorActionSummary action={event.action} />
      : event.tool_name === 'terminal'
        ? <TerminalActionSummary action={event.action} />
        : null
    : null;

  return (
    <EventContainer accentColor={ACTION_ACCENT_COLOR} bgOpacity={0.05} index={index}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: withAlpha(ACTION_ACCENT_COLOR, 9) }}
          >
            <span className="codicon codicon-play text-sm" style={{ color: ACTION_ACCENT_COLOR }} />
          </div>
          <div className="font-semibold text-sm text-stone-200">Agent Action</div>
        </div>
        {event.security_risk && event.security_risk !== 'UNKNOWN' && (
          <SecurityBadge risk={event.security_risk} />
        )}
      </div>

      {thought && (
        <div className="mb-3 text-sm leading-relaxed">
          <div className="font-medium text-xs uppercase tracking-wider text-stone-500 mb-1.5">Reasoning</div>
          <div className="italic text-stone-300">{thought}</div>
        </div>
      )}

      {event.reasoning_content && (
        <div className="mb-3 text-sm leading-relaxed">
          <div className="font-medium text-xs uppercase tracking-wider text-stone-500 mb-1.5">Extended Thinking</div>
          <div className="font-mono text-xs text-stone-400 bg-black/20 rounded-lg p-3 border border-white/[0.04]">{event.reasoning_content}</div>
        </div>
      )}

      {isExecuted && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="codicon codicon-symbol-method" style={{ color: ACTION_ACCENT_COLOR }} />
              <span className="text-teal-300">{event.tool_name}</span>
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors px-2 py-1 rounded-md hover:bg-white/[0.05]"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'}`} />
            </button>
          </div>
          {actionSummary && <div className="mt-2 text-stone-300">{actionSummary}</div>}
          {isExpanded && (
            <pre className="text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto animate-slide-down text-stone-400 mt-2">
              {JSON.stringify(event.action, null, 2)}
            </pre>
          )}
        </div>
      )}
    </EventContainer>
  );
}

/**
 * Renders tool result - shows observation with summary and expandable raw data.
 */
export function ObservationEventBlock({ event, index }: { event: ObservationEvent; index?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const observationString = JSON.stringify(event.observation, null, 2);
  const isTruncated = observationString.length > 2000;
  const observationSummary = event.tool_name === 'file_editor'
    ? <FileEditorObservationSummary observation={event.observation} />
    : event.tool_name === 'terminal'
      ? <TerminalObservationSummary observation={event.observation} />
      : null;
  const hasSummary = observationSummary !== null;
  const shouldShowRaw = !hasSummary || isExpanded;
  const showHeaderToggle = hasSummary;
  const showFooterToggle = !hasSummary && isTruncated;
  const headerToggleLabel = isExpanded ? 'Hide tool result' : 'Show tool result';
  const footerToggleLabel = isExpanded ? 'Show less' : 'Show more';

  return (
    <EventContainer accentColor={OBSERVATION_ACCENT_COLOR} bgOpacity={0.04} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(OBSERVATION_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-eye text-sm" style={{ color: OBSERVATION_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Tool Result</div>
        <span className="font-mono text-xs text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        {showHeaderToggle && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.05]"
            aria-label={headerToggleLabel}
            title={headerToggleLabel}
          >
            <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
          </button>
        )}
      </div>

      {observationSummary && <div className="mb-3 text-stone-300">{observationSummary}</div>}

      {shouldShowRaw && (
        <div className="relative">
          <pre
            className={`text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto leading-relaxed text-stone-400
                        ${!hasSummary && !isExpanded && isTruncated ? 'max-h-40 overflow-hidden' : ''}`}
          >
            {observationString}
          </pre>
          {!hasSummary && !isExpanded && isTruncated && (
            <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-black/40 to-transparent rounded-b-lg" />
          )}
        </div>
      )}
      {showFooterToggle && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.05]"
          aria-label={footerToggleLabel}
          title={footerToggleLabel}
        >
          <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
          <span>{footerToggleLabel}</span>
        </button>
      )}
    </EventContainer>
  );
}

/** Renders user rejection of an agent action with optional reason. */
export function UserRejectBlock({ event, index }: { event: UserRejectObservation; index?: number }) {
  return (
    <EventContainer accentColor={ERROR_ACCENT_COLOR} bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(ERROR_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-close text-sm" style={{ color: ERROR_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Action Rejected</div>
      </div>
      <div className="text-sm">
        <span className="font-mono text-xs text-red-400/70 bg-red-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        {event.rejection_reason && (
          <div className="mt-2 italic text-stone-300">{event.rejection_reason}</div>
        )}
      </div>
    </EventContainer>
  );
}

/** Renders agent error events with tool context. */
export function AgentErrorBlock({ event, index }: { event: AgentErrorEvent; index?: number }) {
  return (
    <EventContainer accentColor={ERROR_ACCENT_COLOR} bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(ERROR_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-warning text-sm" style={{ color: ERROR_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Error</div>
        {event.tool_name && (
          <span className="font-mono text-xs text-red-400/70 bg-red-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        )}
      </div>
      <div className="text-sm font-mono bg-red-500/5 border border-red-500/10 rounded-lg p-3 leading-relaxed text-red-200">
        {event.error}
      </div>
    </EventContainer>
  );
}

/** Renders conversation-level errors (connection, auth, etc). */
export function ConversationErrorBlock({ event, index }: { event: ConversationErrorEvent; index?: number }) {
  return (
    <EventContainer accentColor={ERROR_ACCENT_COLOR} bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(ERROR_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-issues text-sm" style={{ color: ERROR_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Conversation Error</div>
      </div>
      {event.code && (
        <div className="text-xs font-mono mb-2 text-stone-500">Code: {event.code}</div>
      )}
      {event.detail && (
        <details className="text-xs">
          <summary className="cursor-pointer text-stone-400 hover:text-stone-300 font-medium transition-colors">
            Details
          </summary>
          <div className="mt-2 text-sm bg-red-500/5 border border-red-500/10 rounded-lg p-3 font-mono whitespace-pre-wrap break-words text-red-200">
            {event.detail}
          </div>
        </details>
      )}
    </EventContainer>
  );
}

/** Renders condensation event when conversation history is summarized. */
export function CondensationBlock({ event, index }: { event: Condensation; index?: number }) {
  return (
    <EventContainer accentColor={SYSTEM_ACCENT_COLOR} bgOpacity={0.03} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(SYSTEM_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-archive text-sm" style={{ color: SYSTEM_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Conversation Summarized</div>
      </div>
      <div className="text-sm">
        <div className="mb-2 text-stone-400">
          Forgetting {event.forgotten_event_ids.length} events
        </div>
        {event.summary && (
          <div className="bg-black/20 border border-white/[0.04] rounded-lg p-3 leading-relaxed italic text-stone-300">
            {event.summary}
          </div>
        )}
      </div>
    </EventContainer>
  );
}

/**
 * Renders chat messages - user and agent messages with context files,
 * images, skills, and extended thinking/content sections.
 */
export function MessageEventBlock({ event, index }: { event: AgentMessageEvent; index?: number }) {
  const message = event.llm_message;
  const isUser = message.role === 'user';
  const isAgent = message.role === 'assistant';

  const rawText = message.content.filter(isTextContent).map((c) => c.text).join('\n');
  const CONTEXT_HEADER = 'User has selected the following files for you to read:';
  function parseContextBlock(text: string): { main: string; files: string[] } {
    const idx = text.lastIndexOf(CONTEXT_HEADER);
    if (idx === -1) return { main: text, files: [] };
    const before = text.slice(0, idx).trimEnd();
    let after = text.slice(idx + CONTEXT_HEADER.length);
    after = after.replace(/^\r?\n/, '');
    const files = after.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    return { main: before, files };
  }
  const { main: withoutContext, files: contextFiles } = parseContextBlock(rawText);

  const ATTACHMENT_BEGIN = '----- BEGIN ATTACHMENT:';
  const ATTACHMENT_END = '----- END ATTACHMENT:';
  const stripTrailingDashes = (value: string) => value.replace(/\s*-{5,}\s*$/, '').trim();

  function parseAttachmentBlocks(text: string): { main: string; attachments: Array<{ label: string; content: string }> } {
    const attachments: Array<{ label: string; content: string }> = [];
    const parts: string[] = [];
    let cursor = 0;

    while (true) {
      const beginIdx = text.indexOf(ATTACHMENT_BEGIN, cursor);
      if (beginIdx === -1) break;
      parts.push(text.slice(cursor, beginIdx));

      const beginLineEnd = text.indexOf('\n', beginIdx);
      if (beginLineEnd === -1) {
        cursor = beginIdx;
        break;
      }
      const beginLine = text.slice(beginIdx, beginLineEnd).trim();
      let label = stripTrailingDashes(beginLine.slice(ATTACHMENT_BEGIN.length).trim());
      if (!label) label = 'Attachment';

      const endToken = `${ATTACHMENT_END} ${label}`;
      const endIdx = text.indexOf(endToken, beginLineEnd);
      if (endIdx === -1) {
        cursor = beginIdx;
        break;
      }
      const endLineEnd = text.indexOf('\n', endIdx);
      const content = text.slice(beginLineEnd + 1, endIdx).trimEnd();

      attachments.push({ label, content });
      cursor = endLineEnd === -1 ? text.length : endLineEnd + 1;
    }

    parts.push(text.slice(cursor));
    return { main: parts.join('').trim(), attachments };
  }

  const { main: textContent, attachments } = parseAttachmentBlocks(withoutContext);
  const imageContent = message.content.filter((c) => c.type === 'image');

  const accentColor = isUser ? USER_ACCENT_COLOR : isAgent ? AGENT_ACCENT_COLOR : DEFAULT_ACCENT_COLOR;
  const icon = isUser ? 'account' : isAgent ? 'hubot' : 'info';
  const roleLabel = message.role === 'assistant'
    ? 'Agent'
    : message.role.charAt(0).toUpperCase() + message.role.slice(1);

  const handleOpenFile = (file: string) => openWorkspaceFile(file);

  // Agent messages get slightly more prominent styling
  const bgOpacity = isAgent ? 0.06 : 0.04;

  return (
    <EventContainer accentColor={accentColor} bgOpacity={bgOpacity} index={index} dataTestId="message-event">
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 flex-shrink-0"
          style={{ backgroundColor: withAlpha(accentColor, 10) }}
        >
          <span className={`codicon codicon-${icon} text-sm`} style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className={`font-semibold text-sm ${isAgent ? 'text-amber-200' : 'text-stone-300'}`}>{roleLabel}</div>
            {message.created_at && (
              <div className="text-xs text-stone-500">
                {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>

          {textContent && (
            <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isAgent ? 'text-stone-200' : 'text-stone-300'}`}>
              {textContent}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="mb-2 text-xs text-stone-500 flex items-center gap-2">
                <span className="codicon codicon-file text-brand-400/60" />
                <span>Attachments</span>
              </div>
              <div className="space-y-2">
                {attachments.map((a, idx) => (
                  <details key={`${a.label}-${idx}`} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
                    <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-300 font-mono flex items-center gap-2 transition-colors">
                      <span className="codicon codicon-file text-brand-400/60" />
                      <span className="truncate">{a.label}</span>
                    </summary>
                    <pre className="mt-2 font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 leading-relaxed text-stone-400 text-xs overflow-auto whitespace-pre-wrap break-words">
                      {a.content}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {isUser && contextFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="mb-2 text-xs text-stone-500 flex items-center gap-2">
                <span className="codicon codicon-mention" style={{ color: USER_ACCENT_COLOR }} />
                <span>Selected files</span>
              </div>
              <div className="space-y-1">
                {contextFiles.map((file) => (
                  <button
                    key={file}
                    onClick={() => handleOpenFile(file)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/[0.08] transition-all flex items-center gap-2 font-mono text-xs text-stone-400 group"
                    aria-label={`Open ${file}`}
                    title={`Open ${file}`}
                  >
                    <span className="codicon codicon-file text-brand-400/60" />
                    <span className="truncate flex-1">{file}</span>
                    <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {imageContent.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {imageContent.map((img, idx) => {
                if (img.type === 'image' && img.image_urls) {
                  return img.image_urls.map((url, urlIdx) => (
                    <img
                      key={`${idx}-${urlIdx}`}
                      src={url}
                      alt="Message attachment"
                      className="max-w-xs rounded-lg border border-white/[0.08] shadow-lg"
                    />
                  ));
                }
                return null;
              })}
            </div>
          )}

          {message.reasoning_content && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-stone-400 hover:text-stone-300 font-medium mb-2 transition-colors">
                Extended Thinking
              </summary>
              <div className="font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 mt-2 leading-relaxed text-stone-400">
                {message.reasoning_content}
              </div>
            </details>
          )}

          {event.activated_skills && event.activated_skills.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap gap-2">
              {event.activated_skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center px-2.5 py-1 rounded-md text-xs bg-violet-500/15 text-violet-300 border border-violet-400/20"
                >
                  <span className="codicon codicon-mortar-board mr-1.5 text-[10px]" />
                  {skill}
                </span>
              ))}
            </div>
          )}

          {event.extended_content && event.extended_content.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-stone-400 hover:text-stone-300 font-medium transition-colors">
                Extended Context
              </summary>
              <div className="mt-2 space-y-1">
                {event.extended_content.filter(isTextContent).map((content, idx) => (
                  <div key={idx} className="bg-black/20 border border-white/[0.04] rounded-lg p-2 font-mono text-stone-400">
                    {content.text}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </EventContainer>
  );
}

/**
 * Renders live streaming content while agent is generating response.
 * Shows animated cursor and "streaming..." indicator.
 */
export function StreamingMessageBlock({ content }: { content: string }) {
  const accentColor = AGENT_ACCENT_COLOR;

  return (
    <div
      className="relative rounded-xl p-4 my-3 shadow-event border-l-[3px] border-r border-t border-b border-r-white/[0.04] border-t-white/[0.04] border-b-white/[0.02] transition-all duration-200"
      style={{
        borderLeftColor: accentColor,
        background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 6%, transparent) 0%, color-mix(in srgb, ${accentColor} 3%, transparent) 100%)`,
      }}
    >
      {/* Subtle top highlight */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${withAlpha(accentColor, 12)}, transparent 50%)` }}
      />

      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 flex-shrink-0 animate-pulse-glow"
          style={{ backgroundColor: withAlpha(accentColor, 10) }}
        >
          <span className="codicon codicon-hubot text-sm" style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold text-sm text-amber-200">Agent</div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: accentColor }}
              />
              <span className="text-xs text-stone-500">streaming...</span>
            </div>
          </div>

          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-stone-200">
            {content}
            <span
              className="inline-block w-0.5 h-4 ml-0.5 rounded-sm animate-pulse"
              style={{ backgroundColor: accentColor }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
