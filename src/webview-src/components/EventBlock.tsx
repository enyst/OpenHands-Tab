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

type FileEditorCommand = 'view' | 'create' | 'str_replace' | 'insert';
type JsonRecord = Record<string, unknown>;
type LineRange = [number, number];

const isFileEditorCommand = (value: unknown): value is FileEditorCommand =>
  value === 'view' || value === 'create' || value === 'str_replace' || value === 'insert';

const getString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const getNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const getBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const getCharCount = (value: unknown): number | undefined => (typeof value === 'string' ? value.length : undefined);

const parseLineRange = (value: unknown): LineRange | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [start, end] = value;
  if (typeof start !== 'number' || typeof end !== 'number') return undefined;
  return [start, end];
};

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
    return <span className="font-mono text-xs text-white/70">this path</span>;
  }
  return (
    <button
      type="button"
      onClick={() => openWorkspaceFile(path)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-xs font-mono text-brand-300 align-middle max-w-full"
      aria-label={`Open ${path}`}
      title={`Open ${path}`}
    >
      <span className="codicon codicon-file" />
      <span className="truncate max-w-[16rem]">{path}</span>
      <span className="codicon codicon-go-to-file opacity-60" />
    </button>
  );
}

function FileEditorActionSummary({ action }: { action: JsonRecord | null }): JSX.Element | null {
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

function FileEditorObservationSummary({ observation }: { observation: JsonRecord }): JSX.Element | null {
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

// Message accent colors
const USER_ACCENT_COLOR = '#3B82F6';
const AGENT_ACCENT_COLOR = '#D97706';
const DEFAULT_ACCENT_COLOR = '#6B7280';

// Security risk badge component
function SecurityBadge({ risk }: { risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' }) {
  const colors = {
    HIGH: 'bg-red-500/20 text-red-400 border-red-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    LOW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    UNKNOWN: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[risk]}`}>
      {risk}
    </span>
  );
}

// Base event container with accent bar and animation
function EventContainer({
  children,
  accentColor,
  bgOpacity = 0.04,
  className = '',
  index = 0,
}: {
  children: React.ReactNode;
  accentColor: string;
  bgOpacity?: number;
  className?: string;
  index?: number;
}) {
  const animationDelay = `${index * 50}ms`;

  return (
    <div
      className={`
        relative rounded-lg p-4 my-3 shadow-event
        border-l-[3px] transition-all duration-300 hover:shadow-lg
        animate-slide-up
        ${className}
      `}
      style={{
        borderLeftColor: accentColor,
        backgroundColor: `${accentColor}${Math.floor(bgOpacity * 255).toString(16).padStart(2, '0')}`,
        animationDelay,
      }}
    >
      {children}
    </div>
  );
}

// System Prompt Event
export function SystemPromptEventBlock({ event, index }: { event: SystemPromptEvent; index?: number }) {
  return (
    <EventContainer accentColor="#9333EA" index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-gear text-lg" style={{ color: '#9333EA' }} />
        <div className="font-semibold text-base">System Configuration</div>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed opacity-90 font-mono">
        {event.system_prompt.text}
      </div>
      {event.tools && event.tools.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10 text-xs opacity-70 flex items-center gap-2">
          <span className="codicon codicon-tools" />
          <span>{event.tools.length} tools available</span>
        </div>
      )}
    </EventContainer>
  );
}

// Action Event
export function ActionEventBlock({ event, index }: { event: ActionEvent; index?: number }) {
  const thought = event.thought.map((t) => t.text).join('\n');
  const isExecuted = event.action !== null;
  const [isExpanded, setIsExpanded] = useState(false);
  const isFileEditorAction = event.tool_name === 'file_editor';
  const fileEditorSummary = isFileEditorAction ? <FileEditorActionSummary action={event.action} /> : null;

  return (
    <EventContainer accentColor="#3B82F6" index={index}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-play text-lg" style={{ color: '#3B82F6' }} />
          <div className="font-semibold text-base">Agent Action</div>
        </div>
        {event.security_risk && event.security_risk !== 'UNKNOWN' && (
          <SecurityBadge risk={event.security_risk} />
        )}
      </div>

      {thought && (
        <div className="mb-3 text-sm leading-relaxed opacity-90">
          <div className="font-medium text-xs uppercase tracking-wide opacity-60 mb-1">Reasoning</div>
          <div className="italic">{thought}</div>
        </div>
      )}

      {event.reasoning_content && (
        <div className="mb-3 text-sm leading-relaxed opacity-80">
          <div className="font-medium text-xs uppercase tracking-wide opacity-60 mb-1">Extended Thinking</div>
          <div className="font-mono text-xs">{event.reasoning_content}</div>
        </div>
      )}

      {isExecuted && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="codicon codicon-symbol-method" />
              <span className="text-brand-400">{event.tool_name}</span>
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs opacity-60 hover:opacity-100 transition-opacity"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'}`} />
            </button>
          </div>
          {fileEditorSummary && <div className="mt-2">{fileEditorSummary}</div>}
          {isExpanded && (
            <pre className="text-xs font-mono bg-black/20 rounded p-3 overflow-x-auto animate-slide-down">
              {JSON.stringify(event.action, null, 2)}
            </pre>
          )}
        </div>
      )}
    </EventContainer>
  );
}

// Observation Event
export function ObservationEventBlock({ event, index }: { event: ObservationEvent; index?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const observationString = JSON.stringify(event.observation, null, 2);
  const isTruncated = observationString.length > 2000;
  const fileEditorSummary = event.tool_name === 'file_editor' ? (
    <FileEditorObservationSummary observation={event.observation} />
  ) : null;
  const isFileEditorObservation = event.tool_name === 'file_editor' && fileEditorSummary !== null;
  const shouldShowRaw = !isFileEditorObservation || isExpanded;
  const showToggle = isFileEditorObservation || isTruncated;
  const toggleLabel = isFileEditorObservation
    ? isExpanded ? 'Hide raw payload' : 'Show raw payload'
    : isExpanded ? 'Show less' : 'Show more';

  return (
    <EventContainer accentColor="#F59E0B" bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-eye text-lg" style={{ color: '#F59E0B' }} />
        <div className="font-semibold text-base">Tool Result</div>
        <span className="font-mono text-sm text-brand-400">{event.tool_name}</span>
      </div>

      {fileEditorSummary && <div className="mb-3">{fileEditorSummary}</div>}

      {shouldShowRaw && (
        <div className="relative">
          <pre
            className={`text-xs font-mono bg-black/20 rounded p-3 overflow-x-auto leading-relaxed
                        ${!isFileEditorObservation && !isExpanded && isTruncated ? 'max-h-40 overflow-hidden' : ''}`}
          >
            {observationString}
          </pre>
        </div>
      )}

      {showToggle && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-2 text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1"
        >
          <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'}`} />
          {toggleLabel}
        </button>
      )}
    </EventContainer>
  );
}

// User Reject Event
export function UserRejectBlock({ event, index }: { event: UserRejectObservation; index?: number }) {
  return (
    <EventContainer accentColor="#DC2626" bgOpacity={0.08} index={index}>
      <div className="flex items-center gap-2 mb-2">
        <span className="codicon codicon-error text-lg" style={{ color: '#DC2626' }} />
        <div className="font-semibold text-base">Action Rejected</div>
      </div>
      <div className="text-sm">
        <span className="font-mono text-xs opacity-70">{event.tool_name}</span>
        {event.rejection_reason && (
          <div className="mt-2 italic opacity-90">{event.rejection_reason}</div>
        )}
      </div>
    </EventContainer>
  );
}

// Agent Error Event
export function AgentErrorBlock({ event, index }: { event: AgentErrorEvent; index?: number }) {
  return (
    <EventContainer accentColor="#DC2626" bgOpacity={0.08} index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-warning text-lg" style={{ color: '#DC2626' }} />
        <div className="font-semibold text-base">Error</div>
        {event.tool_name && (
          <span className="font-mono text-xs opacity-70">{event.tool_name}</span>
        )}
      </div>
      <div className="text-sm font-mono bg-black/20 rounded p-3 leading-relaxed">
        {event.error}
      </div>
    </EventContainer>
  );
}

// Conversation Error Event
export function ConversationErrorBlock({ event, index }: { event: ConversationErrorEvent; index?: number }) {
  return (
    <EventContainer accentColor="#DC2626" bgOpacity={0.08} index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-issues text-lg" style={{ color: '#DC2626' }} />
        <div className="font-semibold text-base">Conversation Error</div>
      </div>
      {event.code && (
        <div className="text-xs font-mono mb-2 opacity-70">Code: {event.code}</div>
      )}
      {event.detail && (
        <div className="text-sm bg-black/20 rounded p-3">{event.detail}</div>
      )}
    </EventContainer>
  );
}

// Condensation Event - displays when conversation is summarized
export function CondensationBlock({ event, index }: { event: Condensation; index?: number }) {
  return (
    <EventContainer accentColor="#9333EA" bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-archive text-lg" style={{ color: '#9333EA' }} />
        <div className="font-semibold text-base">Conversation Summarized</div>
      </div>
      <div className="text-sm opacity-90">
        <div className="mb-2">
          <span className="opacity-70">Forgetting {event.forgotten_event_ids.length} events</span>
        </div>
        {event.summary && (
          <div className="bg-black/20 rounded p-3 leading-relaxed italic">
            {event.summary}
          </div>
        )}
      </div>
    </EventContainer>
  );
}

// Message Event (User/Agent messages)
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
  const { main: textContent, files: contextFiles } = parseContextBlock(rawText);
  const imageContent = message.content.filter((c) => c.type === 'image');

  const accentColor = isUser ? USER_ACCENT_COLOR : isAgent ? AGENT_ACCENT_COLOR : DEFAULT_ACCENT_COLOR;
  const icon = isUser ? 'account' : isAgent ? 'hubot' : 'info';

  const handleOpenFile = (file: string) => openWorkspaceFile(file);

  return (
    <EventContainer accentColor={accentColor} bgOpacity={0.06} index={index}>
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0"
          style={{ backgroundColor: `${accentColor}20` }}
        >
          <span className={`codicon codicon-${icon} text-sm`} style={{ color: accentColor }} />


        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold text-sm capitalize">{message.role}</div>
            {message.created_at && (
              <div className="text-xs opacity-50">
                {new Date(message.created_at).toLocaleTimeString()}
              </div>
            )}
          </div>

          {textContent && (
            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {textContent}
            </div>
          )}

          {isUser && contextFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10">
              <div className="mb-2 text-xs opacity-70 flex items-center gap-2">
                <span className="codicon codicon-mention" />
                <span>Selected files</span>
              </div>
              <div className="space-y-1">
                {contextFiles.map((file) => (
                  <button
                    key={file}
                    onClick={() => handleOpenFile(file)}
                    className="w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 transition flex items-center gap-2 font-mono text-xs"
                    aria-label={`Open ${file}`}
                    title={`Open ${file}`}
                  >
                    <span className="codicon codicon-file" />
                    <span className="truncate flex-1">{file}</span>
                    <span className="codicon codicon-go-to-file opacity-60" />
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
                      className="max-w-xs rounded border border-white/10"
                    />
                  ));
                }
                return null;
              })}
            </div>
          )}

          {message.reasoning_content && (
            <details className="mt-3 text-xs opacity-80">
              <summary className="cursor-pointer hover:opacity-100 font-medium mb-2">
                Extended Thinking

              </summary>
              <div className="font-mono bg-black/20 rounded p-3 mt-2 leading-relaxed">
                {message.reasoning_content}
              </div>
            </details>
          )}

          {event.activated_skills && event.activated_skills.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap gap-2">
              {event.activated_skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-purple-500/20 text-purple-300"
                >
                  <span className="codicon codicon-mortar-board mr-1" />
                  {skill}
                </span>
              ))}
            </div>
          )}

          {event.extended_content && event.extended_content.length > 0 && (
            <details className="mt-3 text-xs opacity-80">
              <summary className="cursor-pointer hover:opacity-100 font-medium">
                Extended Context
              </summary>
              <div className="mt-2 space-y-1">
                {event.extended_content.filter(isTextContent).map((content, idx) => (
                  <div key={idx} className="bg-black/20 rounded p-2 font-mono">
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

// Streaming Message Block - displays incrementally arriving LLM content
export function StreamingMessageBlock({ content }: { content: string }) {
  const accentColor = AGENT_ACCENT_COLOR;

  return (
    <div
      className="relative rounded-lg p-4 my-3 shadow-event border-l-[3px] transition-all duration-300"
      style={{
        borderLeftColor: accentColor,
        backgroundColor: `${accentColor}06`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5 flex-shrink-0"
          style={{ backgroundColor: `${accentColor}20` }}
        >
          <span className="codicon codicon-hubot text-sm" style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold text-sm">Assistant</div>
            <div className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: accentColor }} />
              <span className="text-xs opacity-50">streaming...</span>
            </div>
          </div>

          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {content}
            <span className="inline-block w-0.5 h-4 ml-0.5 animate-pulse" style={{ backgroundColor: accentColor }} />
          </div>
        </div>
      </div>
    </div>
  );
}
