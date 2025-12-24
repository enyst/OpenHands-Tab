import type { AgentErrorEvent, ConversationErrorEvent } from '@openhands/agent-sdk-ts';
import { ERROR_ACCENT_COLOR, EventContainer, withAlpha } from './shared';

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

