import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { getVscodeApi } from '../../shared/vscodeApi';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';

type FileEditorCommand = 'view' | 'create' | 'str_replace' | 'insert';
type JsonRecord = Record<string, unknown>;
type LineRange = [number, number];

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

const postMessage = (message: WebviewToHostMessage) => {
  const api = getVscodeApi();
  api.postMessage(message);
};

export const openWorkspaceFile = (path: string) => {
  postMessage({ type: 'openWorkspaceFile', path });
};

export const openWorkspaceDiff = (path: string, oldContent: string, newContent: string, options?: { preferGitHead?: boolean }) => {
  postMessage({
    type: 'openWorkspaceDiff',
    path,
    oldContent,
    newContent,
    ...(options?.preferGitHead ? { preferGitHead: true } : {}),
  });
};

export const openMarkdownLink = (href: string) => {
  postMessage({ type: 'openMarkdownLink', href });
};

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const safeHref = typeof href === 'string' ? href : '';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (!safeHref.trim()) return;
        openMarkdownLink(safeHref);
      }}
      className="text-brand-300 underline decoration-white/20 hover:decoration-white/40 hover:text-brand-200 transition-colors"
    >
      {children}
    </button>
  );
}

const ALLOWED_DATA_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
const MAX_DATA_IMAGE_URL_CHARS = 1_000_000;
const ALLOWED_WEBVIEW_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function isAllowedDataImageUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed.startsWith('data:')) return false;
  if (trimmed.length > MAX_DATA_IMAGE_URL_CHARS) return false;

  const match = /^data:([^;,]+)[;,]/.exec(trimmed);
  const mime = match?.[1]?.toLowerCase();
  if (!mime) return false;
  if (!mime.startsWith('image/')) return false;
  return ALLOWED_DATA_IMAGE_MIME_TYPES.has(mime);
}

function isAllowedWebviewImageUrl(url: string): boolean {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return false;
  if (trimmed.length > MAX_DATA_IMAGE_URL_CHARS) return false;

  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed);
  if (!schemeMatch) return false;

  const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
  if (scheme !== 'vscode-webview-resource' && scheme !== 'vscode-resource' && scheme !== 'vscode-webview') {
    return false;
  }

  const withoutQuery = trimmed.split(/[?#]/)[0].toLowerCase();
  return ALLOWED_WEBVIEW_IMAGE_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext));
}

export function MarkdownMessage({ text }: { text: string }) {
  const safeUrlTransform = (url: string, key?: string) => {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return '';
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return trimmed; // Windows absolute path

    const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed);
    if (!schemeMatch) return trimmed;

    const scheme = schemeMatch[0].slice(0, -1).toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed;
    if (key === 'src') {
      if (scheme === 'data' && isAllowedDataImageUrl(trimmed)) return trimmed;
      if (isAllowedWebviewImageUrl(trimmed)) return trimmed;
    }

    return '';
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      urlTransform={safeUrlTransform}
      components={{
        a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
        img: ({ src, alt }) => {
          const cleanSrc = typeof src === 'string' ? src.trim() : '';
          const cleanAlt = typeof alt === 'string' ? alt.trim() : '';
          const label = cleanAlt || cleanSrc || 'image';

          if (!cleanSrc) return <span className="text-stone-400">{label}</span>;

          if (isAllowedDataImageUrl(cleanSrc) || isAllowedWebviewImageUrl(cleanSrc)) {
            return (
              <img
                src={cleanSrc}
                alt={cleanAlt}
                className="max-w-full rounded-lg border border-white/[0.06] shadow-event my-2"
              />
            );
          }

          return <MarkdownLink href={src}>{label}</MarkdownLink>;
        },
        p: ({ children }) => <p className="mt-2 first:mt-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mt-2 first:mt-0 list-disc pl-6 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="mt-2 first:mt-0 list-decimal pl-6 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="mt-2 first:mt-0 pl-3 border-l-2 border-white/[0.12] text-stone-300 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-white/[0.08]" />,
        h1: ({ children }) => <h1 className="text-lg font-semibold mt-3 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 first:mt-0">{children}</h3>,
        pre: ({ children }) => (
          <pre className="mt-2 first:mt-0 font-mono bg-black/20 border border-white/[0.04] rounded-lg p-3 leading-relaxed text-xs overflow-auto whitespace-pre [&_code]:bg-transparent [&_code]:border-0 [&_code]:px-0 [&_code]:py-0 [&_code]:rounded-none">
            {children}
          </pre>
        ),
        code: ({ className, children }) => (
          <code
            className={[
              'px-1.5 py-0.5 rounded-md bg-black/25 border border-white/[0.06] font-mono text-xs text-stone-200',
              typeof className === 'string' ? className : '',
            ].filter(Boolean).join(' ')}
          >
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function InlineFileReference({ path }: { path?: string }) {
  if (!path) {
    return <span className="font-mono text-xs text-stone-400">this path</span>;
  }

  const trimmedPath = path.replace(/[\\/]+$/, '');
  const normalizedPath = trimmedPath.replaceAll('\\', '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const basename = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
  const label = basename || normalizedPath || path;

  return (
    <button
      type="button"
      onClick={() => openWorkspaceFile(path)}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.1] text-xs font-mono text-brand-300 align-middle max-w-full transition-all duration-150 group"
      aria-label={`Open ${path}`}
      title={`Open ${path}`}
    >
      <span className="codicon codicon-file text-brand-400/70" />
      <span className="truncate max-w-[16rem]">{label}</span>
      <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
    </button>
  );
}

const normalizeDiffContent = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  return undefined;
};

function InlineFileDiffReference({ path, oldContent, newContent }: { path?: string; oldContent: unknown; newContent: unknown }) {
  if (!path) {
    return <span className="font-mono text-xs text-stone-400">this path</span>;
  }

  const trimmedPath = path.replace(/[\\/]+$/, '');
  const normalizedPath = trimmedPath.replaceAll('\\', '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const basename = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
  const label = basename || normalizedPath || path;

  const oldText = normalizeDiffContent(oldContent);
  const newText = normalizeDiffContent(newContent);
  if (oldText === undefined || newText === undefined) {
    return <InlineFileReference path={path} />;
  }

  return (
    <button
      type="button"
      onClick={() => openWorkspaceDiff(path, oldText, newText, { preferGitHead: true })}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.1] text-xs font-mono text-brand-300 align-middle max-w-full transition-all duration-150 group"
      aria-label={`View diff for ${path}`}
      title={`View diff for ${path}`}
    >
      <span className="codicon codicon-diff text-brand-400/70" />
      <span className="truncate max-w-[16rem]">{label}</span>
      <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
    </button>
  );
}

const TerminalCommandPreview = ({ command }: { command?: string }): React.ReactElement | null => {
  if (!command) return null;
  return (
    <pre className="text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto text-stone-300">
      <span className="text-stone-500 select-none">$ </span>{command}
    </pre>
  );
};

/** Renders human-readable summary for file_editor actions */
export function FileEditorActionSummary({ action }: { action: JsonRecord | null }): React.ReactElement | null {
  if (!action) return null;
  const command = getString(action.command);
  if (!isFileEditorCommand(command)) return null;
  const path = getString(action.path);

  switch (command) {
    case 'view': {
      const rangeText = formatLineRange(parseLineRange(action.view_range));
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>The agent wants to read</p>
          <InlineFileReference path={path} />
          {rangeText && <p className="text-xs opacity-70">Requested {rangeText}.</p>}
        </div>
      );
    }
    case 'create': {
      const planned = formatCharCount(getCharCount(action.file_text));
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>The agent wants to create</p>
          <InlineFileReference path={path} />
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
            The agent wants to insert text
            {typeof insertLine === 'number' && (
              <> at line {insertLine.toLocaleString()}</>
            )}
          </p>
          <InlineFileReference path={path} />
          {planned && <p className="text-xs opacity-70">They plan to insert {planned}.</p>}
        </div>
      );
    }
    case 'str_replace': {
      const planned = formatCharCount(getCharCount(action.new_str));
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>The agent wants to replace text in</p>
          <InlineFileReference path={path} />
          {planned && <p className="text-xs opacity-70">They plan to write {planned}.</p>}
        </div>
      );
    }
    default:
      return null;
  }
}

export function FileEditorObservationSummary({ observation }: { observation: JsonRecord }): React.ReactElement | null {
  const path = getString(observation.path);
  const command = getString(observation.command);
  const prevExist = observation.prev_exist === true ? true : observation.prev_exist === false ? false : undefined;
  const rawOld = observation.old_content;
  const rawNew = observation.new_content;
  const oldLength = getCharCount(rawOld);
  const newLength = getCharCount(rawNew);
  const summary = getString(observation.summary)?.trim();

  if (!isFileEditorCommand(command)) return null;

  switch (command) {
    case 'view': {
      const listedDirectory = rawOld === null && typeof rawNew === 'string';
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>Agent {listedDirectory ? 'listed the contents of' : 'read'}</p>
          <InlineFileReference path={path} />
        </div>
      );
    }
    case 'create': {
      const sizeText = formatCharCount(newLength);
      const verb = prevExist === true ? 'overwrote' : 'created';
      return (
        <div className="text-sm leading-relaxed space-y-1">
          <p>Agent {verb}</p>
          <InlineFileDiffReference path={path} oldContent={rawOld} newContent={rawNew} />
          {sizeText && <p className="text-xs opacity-70">File now contains {sizeText}.</p>}
        </div>
      );
    }
    case 'insert':
    case 'str_replace': {
      const detail = formatSizeDelta(oldLength, newLength);
      return (
        <div className="text-sm leading-relaxed space-y-1">
          {summary ? <p>{summary}</p> : <p>Agent {command === 'insert' ? 'inserted text into' : 'replaced text in'}</p>}
          <InlineFileDiffReference path={path} oldContent={rawOld} newContent={rawNew} />
          {detail && <p className="text-xs opacity-70">{detail}</p>}
        </div>
      );
    }
    default:
      return null;
  }
}

export function TerminalActionSummary({ action }: { action: JsonRecord | null }): React.ReactElement | null {
  if (!action) return null;
  const command = getString(action.command);
  return (
    <div className="text-sm leading-relaxed space-y-1">
      <p>The agent wants to execute a terminal command.</p>
      <TerminalCommandPreview command={command} />
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
}): React.ReactElement | null {
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
  const toggleLabel = isExpanded ? 'Hide tool result' : 'Show tool result';
  return (
    <div className="text-sm leading-relaxed">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 text-left text-xs text-stone-400 hover:text-stone-300 transition-colors bg-black/20 border border-white/[0.04] rounded-lg px-3 py-2 hover:bg-white/[0.04]"
        aria-label={toggleLabel}
        title={toggleLabel}
      >
        <span className="flex-1 min-w-0 text-sm text-stone-300 whitespace-pre-wrap break-words">{summaryText}</span>
        <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
      </button>
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
}: {
  children: React.ReactNode;
  accentColor: string;
  bgOpacity?: number;
  className?: string;
  index?: number;
  dataTestId?: string;
  alignRight?: boolean;
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
