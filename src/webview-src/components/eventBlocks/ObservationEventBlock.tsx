import { useState } from 'react';
import type { ObservationEvent } from '@openhands/agent-sdk-ts';
import { EventContainer, FileEditorObservationSummary, OBSERVATION_ACCENT_COLOR, TerminalObservationSummary, withAlpha } from './shared';
import { Tooltip } from '../Tooltip';

/**
 * Renders tool result - shows observation with summary and expandable raw data.
 */
export function ObservationEventBlock({ event, index }: { event: ObservationEvent; index?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isFileEditObservation = (() => {
    if (event.tool_name !== 'file_editor') return false;
    const candidate = (event.observation as Record<string, unknown> | null) ?? null;
    if (!candidate || typeof candidate !== 'object') return false;
    const command = typeof candidate.command === 'string' ? candidate.command : '';
    return command === 'insert' || command === 'str_replace';
  })();
  const observationSummary = event.tool_name === 'file_editor'
    ? <FileEditorObservationSummary observation={event.observation} />
    : event.tool_name === 'terminal'
      ? <TerminalObservationSummary observation={event.observation} isExpanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)} />
      : null;
  const hasSummary = observationSummary !== null;
  const shouldShowRaw = isFileEditObservation ? false : !hasSummary || isExpanded;
  const observationString = shouldShowRaw ? JSON.stringify(event.observation, null, 2) : '';
  const isTruncated = shouldShowRaw && observationString.length > 2000;
  const showHeaderToggle = hasSummary && event.tool_name !== 'terminal' && !isFileEditObservation;
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
        <span className="font-mono text-xs text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        {showHeaderToggle && (
          <Tooltip content={headerToggleLabel} position="left">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.05]"
              aria-label={headerToggleLabel}
            >
              <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
            </button>
          </Tooltip>
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
        <Tooltip content={footerToggleLabel} position="top">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-2 text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.05]"
            aria-label={footerToggleLabel}
          >
            <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
            <span>{footerToggleLabel}</span>
          </button>
        </Tooltip>
      )}
    </EventContainer>
  );
}
