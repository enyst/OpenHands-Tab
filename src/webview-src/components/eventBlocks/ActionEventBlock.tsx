import { useState } from 'react';
import type { ActionEvent } from '@openhands/agent-sdk-ts';
import { SecurityRiskBadge } from '../SecurityRiskBadge';
import { ACTION_ACCENT_COLOR, EventContainer, FileEditorActionSummary, TerminalActionSummary, withAlpha } from './shared';

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
          <SecurityRiskBadge risk={event.security_risk} />
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
              <span className="text-amber-300">{event.tool_name}</span>
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

