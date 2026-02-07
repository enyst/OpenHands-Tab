import type { ReactElement } from 'react';
import { Tooltip } from '../Tooltip';
import { openWorkspaceDiff, openWorkspaceFile } from './openers';

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

const normalizeDiffContent = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  return undefined;
};

export function InlineFileReference({ path }: { path?: string }) {
  if (!path) {
    return <span className="font-mono text-xs text-stone-400">this path</span>;
  }

  const trimmedPath = path.replace(/[\\/]+$/, '');
  const normalizedPath = trimmedPath.replaceAll('\\', '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const basename = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
  const label = basename || normalizedPath || path;

  return (
    <Tooltip content={`Open ${path}`} position="top">
      <button
        type="button"
        onClick={() => openWorkspaceFile(path)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.1] text-xs font-mono text-brand-300 align-middle max-w-full transition-all duration-150 group"
        aria-label={`Open ${path}`}
      >
        <span className="codicon codicon-file text-brand-400/70" />
        <span className="truncate max-w-[16rem]">{label}</span>
        <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
      </button>
    </Tooltip>
  );
}

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
    <Tooltip content={`View diff for ${path}`} position="top">
      <button
        type="button"
        onClick={() => openWorkspaceDiff(path, oldText, newText, { preferGitHead: true })}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.1] text-xs font-mono text-brand-300 align-middle max-w-full transition-all duration-150 group"
        aria-label={`View diff for ${path}`}
      >
        <span className="codicon codicon-diff text-brand-400/70" />
        <span className="truncate max-w-[16rem]">{label}</span>
        <span className="codicon codicon-go-to-file opacity-40 group-hover:opacity-70 transition-opacity" />
      </button>
    </Tooltip>
  );
}

/** Renders human-readable summary for file_editor actions */
export function FileEditorActionSummary({ action }: { action: JsonRecord | null }): ReactElement | null {
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

/** Renders human-readable summary for file_editor observations */
export function FileEditorObservationSummary({ observation }: { observation: JsonRecord }): ReactElement | null {
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
