import { useState } from 'react';
import type { ObservationEvent } from '@openhands/agent-sdk-ts';
import {
  BrowserObservationSummary,
  EventContainer,
  FileEditorObservationSummary,
  GlobObservationSummary,
  GrepObservationSummary,
  MarkdownMessage,
  OBSERVATION_ACCENT_COLOR,
  TerminalObservationSummary,
  withAlpha,
} from './shared';
import { Tooltip } from '../Tooltip';

/**
 * Renders environment result - shows observation with summary and expandable raw data.
 */
export function ObservationEventBlock({ event, index }: { event: ObservationEvent; index?: number }) {
  const redactObservationText = (text: string): string => {
    const REDACTED = '[REDACTED]';
    let t = text;

    // Authorization / Bearer patterns
    t = t.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);
    t = t.replace(/(Bearer\s+)[^\s]+/gi, `$1${REDACTED}`);

    // Common token prefixes
    t = t.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, REDACTED);
    t = t.replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/gi, REDACTED);
    t = t.replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/gi, REDACTED);

    // AWS access key ids (AKIA..., ASIA...)
    t = t.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED);

    // Common key=value or key: value patterns
    const keyPattern =
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?api[_-]?key|password|secret|client[_-]?secret|aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)/gi;
    t = t.replace(new RegExp(`(${keyPattern.source})\\s*[:=]\\s*"?([^"\\s&]+)"?`, 'gi'), (_m, key) => `${key}: ${REDACTED}`);
    t = t.replace(new RegExp(`([?&])(${keyPattern.source})=([^&\\s]+)`, 'gi'), (_m, sep, key) => `${sep}${key}=${REDACTED}`);

    return t;
  };

  const [isExpanded, setIsExpanded] = useState(false);
  const isFinishTool = event.tool_name === 'finish';
  const maybeMessage = isFinishTool ? event.observation['message'] : undefined;
  const finishMessage = typeof maybeMessage === 'string' ? maybeMessage.trim() : '';

  // Special-case: Finish tool should show a concise, green summary inline on the header row
  if (isFinishTool) {
    return (
      <EventContainer accentColor={OBSERVATION_ACCENT_COLOR} bgOpacity={0.04} index={index}>
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: withAlpha(OBSERVATION_ACCENT_COLOR, 9) }}
          >
            <span className="codicon codicon-eye text-sm" style={{ color: OBSERVATION_ACCENT_COLOR }} />
          </div>
          <div className="font-semibold text-sm text-stone-200">Environment Result</div>
          <span className="font-mono text-xs text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="codicon codicon-check text-green-700" />
          </div>
        </div>

        {finishMessage && (
          <div className="mt-2 text-sm leading-relaxed">
            <div className="text-green-700">
              <MarkdownMessage text={finishMessage} />
            </div>
          </div>
        )}
      </EventContainer>
    );
  }

  const isFileEditObservation = (() => {
    if (event.tool_name !== 'file_editor') return false;
    const candidate = (event.observation as Record<string, unknown> | null) ?? null;
    if (!candidate || typeof candidate !== 'object') return false;
    const command = typeof candidate.command === 'string' ? candidate.command : '';
    return command === 'insert' || command === 'str_replace';
  })();
  const observationSummary = (() => {
    switch (event.tool_name) {
      case 'file_editor':
        return <FileEditorObservationSummary observation={event.observation} />;
      case 'terminal':
        return <TerminalObservationSummary observation={event.observation} isExpanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)} />;
      case 'glob':
        return <GlobObservationSummary observation={event.observation} />;
      case 'grep':
        return <GrepObservationSummary observation={event.observation} />;
      case 'browser':
        return <BrowserObservationSummary observation={event.observation} />;
      default:
        return null;
    }
  })();
  const hasSummary = observationSummary !== null;
  const shouldShowRaw = isFileEditObservation ? false : !hasSummary || isExpanded;
  const observationString = shouldShowRaw ? redactObservationText(JSON.stringify(event.observation, null, 2)) : '';
  const isTruncated = shouldShowRaw && observationString.length > 2000;
  const showHeaderToggle = hasSummary && event.tool_name !== 'terminal' && !isFileEditObservation;
  const showFooterToggle = !hasSummary && isTruncated;
  const headerToggleLabel = isExpanded ? 'Hide environment result' : 'Show environment result';
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
        <div className="font-semibold text-sm text-stone-200">Environment Result</div>
        <span className="font-mono text-xs text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        {showHeaderToggle && (
          <Tooltip content={headerToggleLabel} position="right">
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
