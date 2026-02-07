import type { MouseEventHandler, ReactElement, ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import { InlineFileReference } from './fileEditorSummary';

export { openMarkdownLink, openWorkspaceDiff, openWorkspaceFile } from './openers';
export { MarkdownMessage, stripEnvironmentInformationBlocks } from './markdown';
export { FileEditorActionSummary, FileEditorObservationSummary } from './fileEditorSummary';

type JsonRecord = Record<string, unknown>;

const getString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const getNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

const TerminalCommandPreview = ({ command }: { command?: string }): ReactElement | null => {
  if (!command) return null;
  return (
    <pre className="text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto text-stone-300">
      <span className="text-stone-500 select-none">$ </span>{command}
    </pre>
  );
};

export function TerminalActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const command = getString(action.command);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to execute a terminal command.</p>
      <TerminalCommandPreview command={command} />
    </div>
  );
}

export function ThinkActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const thought = getString(action.thought);
  if (!thought) return null;
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent logged a thought.</p>
      <pre className="font-mono text-xs text-stone-400 bg-black/20 rounded-lg p-3 border border-white/[0.04] whitespace-pre-wrap break-words">
        {thought}
      </pre>
    </div>
  );
}

export function TerminalObservationSummary({
  observation,
  isExpanded,
  onToggle,
}: {
  observation: JsonRecord;
  isExpanded: boolean;
  onToggle: () => void;
}): ReactElement | null {
  const exitCodeNumber = getNumber(observation.exit_code);
  const exitCodeText = exitCodeNumber !== undefined ? exitCodeNumber.toString() : getString(observation.exit_code) ?? 'unknown';
  const metadata = observation.metadata;
  const metadataSummary =
    metadata && typeof metadata === 'object' && 'summary' in metadata
      ? getString((metadata as Record<string, unknown>).summary)
      : undefined;
  const geminiSummary = getString(observation.summary) ?? metadataSummary;
  const trimmedGeminiSummary = geminiSummary?.trim() ? geminiSummary.trim() : undefined;
  const summaryText = trimmedGeminiSummary ?? (exitCodeText === '0' ? 'Done.' : `Done (exit code ${exitCodeText}).`);
  const toggleLabel = isExpanded ? 'Hide environment result' : 'Show environment result';
  return (
    <div className="text-sm leading-relaxed">
      <Tooltip content={toggleLabel} position="top">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between gap-3 text-left text-xs text-stone-400 hover:text-stone-300 transition-colors bg-black/20 border border-white/[0.04] rounded-lg px-3 py-2 hover:bg-white/[0.04]"
          aria-label={toggleLabel}
        >
          <span className="flex-1 min-w-0 text-sm text-stone-300 whitespace-pre-wrap break-words">{summaryText}</span>
          <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
        </button>
      </Tooltip>
    </div>
  );
}

/** Renders human-readable summary for glob action */
export function GlobActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const pattern = getString(action.pattern);
  const searchPath = getString(action.path);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to search for files matching a pattern.</p>
      {pattern && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">Pattern:</span>
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300">{pattern}</code>
        </div>
      )}
      {searchPath && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">In:</span>
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300">{searchPath}</code>
        </div>
      )}
    </div>
  );
}

/** Renders human-readable summary for glob observation */
export function GlobObservationSummary({ observation }: { observation: JsonRecord }): ReactElement | null {
  const files = Array.isArray(observation.files) ? observation.files.filter((f): f is string => typeof f === 'string') : [];
  const pattern = getString(observation.pattern);
  const searchPath = getString(observation.searchPath);
  const truncated = observation.truncated === true;
  const count = files.length;

  return (
    <div className="text-sm leading-relaxed space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-stone-300">
          Found <span className="font-semibold text-brand-300">{count}</span> file{count === 1 ? '' : 's'}
          {truncated && <span className="text-stone-500"> (results truncated)</span>}
        </span>
      </div>
      {pattern && (
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <span className="codicon codicon-search text-brand-400/60" />
          <code className="font-mono">{pattern}</code>
          {searchPath && <span className="text-stone-500">in {searchPath}</span>}
        </div>
      )}
      {count > 0 && count <= 10 && (
        <div className="space-y-0.5">
          {files.slice(0, 10).map((file, i) => (
            <div key={i} className="flex items-center gap-2">
              <InlineFileReference path={file} />
            </div>
          ))}
        </div>
      )}
      {count > 10 && (
        <div className="text-xs text-stone-500">
          Showing first 10 results. Expand to see the full raw data.
        </div>
      )}
    </div>
  );
}

/** Renders human-readable summary for grep action */
export function GrepActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const pattern = getString(action.pattern);
  const searchPath = getString(action.path);
  const include = getString(action.include);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to search file contents for a pattern.</p>
      {pattern && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">Regex:</span>
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300">{pattern}</code>
        </div>
      )}
      {include && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">Files:</span>
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300">{include}</code>
        </div>
      )}
      {searchPath && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">In:</span>
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300">{searchPath}</code>
        </div>
      )}
    </div>
  );
}

/** Renders human-readable summary for grep observation */
export function GrepObservationSummary({ observation }: { observation: JsonRecord }): ReactElement | null {
  const matches = Array.isArray(observation.matches) ? observation.matches.filter((f): f is string => typeof f === 'string') : [];
  const pattern = getString(observation.pattern);
  const searchPath = getString(observation.searchPath);
  const includePattern = getString(observation.includePattern);
  const truncated = observation.truncated === true;
  const count = matches.length;

  return (
    <div className="text-sm leading-relaxed space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-stone-300">
          Found <span className="font-semibold text-brand-300">{count}</span> matching file{count === 1 ? '' : 's'}
          {truncated && <span className="text-stone-500"> (results truncated)</span>}
        </span>
      </div>
      {pattern && (
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <span className="codicon codicon-regex text-brand-400/60" />
          <code className="font-mono">{pattern}</code>
          {includePattern && <span className="text-stone-500">in {includePattern} files</span>}
          {searchPath && <span className="text-stone-500">under {searchPath}</span>}
        </div>
      )}
      {count > 0 && count <= 10 && (
        <div className="space-y-0.5">
          {matches.slice(0, 10).map((file, i) => (
            <div key={i} className="flex items-center gap-2">
              <InlineFileReference path={file} />
            </div>
          ))}
        </div>
      )}
      {count > 10 && (
        <div className="text-xs text-stone-500">
          Showing first 10 results. Expand to see the full raw data.
        </div>
      )}
    </div>
  );
}

/** Renders human-readable summary for browser (web fetch) action */
export function BrowserActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const url = getString(action.url);
  const method = getString(action.method) ?? 'GET';
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to fetch a web resource.</p>
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-400/20 text-xs font-mono text-blue-300">{method}</span>
        {url && (
          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/[0.06] font-mono text-xs text-stone-300 truncate max-w-md">{url}</code>
        )}
      </div>
    </div>
  );
}

/** Renders human-readable summary for browser (web fetch) observation */
export function BrowserObservationSummary({ observation }: { observation: JsonRecord }): ReactElement | null {
  const url = getString(observation.url);
  const status = getNumber(observation.status);
  const content = getString(observation.content);
  const contentLength = content?.length ?? 0;

  const isSuccess = status !== undefined && status >= 200 && status < 300;
  const statusColor = isSuccess ? 'text-green-400' : status !== undefined && status >= 400 ? 'text-red-400' : 'text-stone-400';

  return (
    <div className="text-sm leading-relaxed space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {status !== undefined && (
          <span className={`px-1.5 py-0.5 rounded bg-black/30 border border-white/[0.06] text-xs font-mono ${statusColor}`}>
            {status}
          </span>
        )}
        {url && (
          <code className="font-mono text-xs text-stone-400 truncate max-w-md">{url}</code>
        )}
      </div>
      {contentLength > 0 && (
        <div className="text-xs text-stone-500">
          Received {contentLength.toLocaleString()} characters
        </div>
      )}
    </div>
  );
}

/** Renders human-readable summary for finish action */
export function FinishActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
  if (!action) return null;
  const message = getString(action.message);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p className="text-stone-300">The agent wants to finish the current task.</p>
      {message && (
        <div className="italic text-stone-400">{message}</div>
      )}
    </div>
  );
}

/** Renders human-readable summary for finish observation */
export function FinishObservationSummary({ observation }: { observation: JsonRecord }): ReactElement | null {
  const message = getString(observation.message);
  return (
    <div className="text-sm leading-relaxed">
      <div className="flex items-center gap-2">
        <span className="codicon codicon-check-all text-green-400" />
        <span className="text-stone-300">Task completed</span>
      </div>
      {message && (
        <div className="mt-1 italic text-stone-400">{message}</div>
      )}
    </div>
  );
}

/**
 * Event color tokens - CSS custom properties defined in tailwind.css
 * Design Philosophy: "Simplified Warm Palette"
 * - Agent/Actions/Observations: OpenHands golden (the main voice)
 * - User: Warm grey (understated)
 * - Error: Warm coral (alerting)
 */
export const USER_ACCENT_COLOR = 'var(--event-user)';
export const AGENT_ACCENT_COLOR = 'var(--event-agent)';
export const DEFAULT_ACCENT_COLOR = 'var(--event-default)';
export const ERROR_ACCENT_COLOR = 'var(--event-error)';
// Use agent golden for all OpenHands actions/observations/system events
export const SYSTEM_ACCENT_COLOR = AGENT_ACCENT_COLOR;
export const ACTION_ACCENT_COLOR = AGENT_ACCENT_COLOR;
export const OBSERVATION_ACCENT_COLOR = AGENT_ACCENT_COLOR;

/** Mix a CSS color with transparency - use instead of appending hex alpha to CSS vars */
export const withAlpha = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Base event container with accent bar and refined styling.
 * Uses warm gradients and subtle shadows for depth.
 */
export function EventContainer({
  children,
  accentColor,
  bgOpacity = 0.04,
  className = '',
  index = 0,
  dataTestId,
  alignRight = false,
  onMouseLeave,
}: {
  children: ReactNode;
  accentColor: string;
  bgOpacity?: number;
  className?: string;
  index?: number;
  dataTestId?: string;
  alignRight?: boolean;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
}) {
  const animationDelay = `${index * 40}ms`;
  const bgOpacityPercent = Math.round(bgOpacity * 100);

  const borderClasses = alignRight
    ? 'border-r-[3px] border-l border-t border-b border-l-white/[0.04] border-t-white/[0.04] border-b-white/[0.02]'
    : 'border-l-[3px] border-r border-t border-b border-r-white/[0.04] border-t-white/[0.04] border-b-white/[0.02]';

  const hoverClasses = alignRight
    ? 'hover:border-l-white/[0.06]'
    : 'hover:border-r-white/[0.06]';

  return (
    <div
      data-testid={dataTestId}
      className={`
        relative rounded-xl p-4 my-3
        ${borderClasses}
        shadow-event transition-all duration-200
        hover:shadow-event-hover ${hoverClasses}
        animate-slide-up
        ${alignRight ? 'ml-auto max-w-[85%]' : ''}
        ${className}
      `}
      onMouseLeave={onMouseLeave}
      style={{
        [alignRight ? 'borderRightColor' : 'borderLeftColor']: accentColor,
        background: `linear-gradient(${alignRight ? '225deg' : '135deg'}, color-mix(in srgb, ${accentColor} ${bgOpacityPercent}%, transparent) 0%, color-mix(in srgb, ${accentColor} ${Math.round(bgOpacity * 50)}%, transparent) 100%)`,
        animationDelay,
      }}
    >
      {/* Subtle top highlight for depth */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-xl"
        style={{ background: `linear-gradient(${alignRight ? '270deg' : '90deg'}, ${withAlpha(accentColor, 12)}, transparent 50%)` }}
      />
      {children}
    </div>
  );
}
