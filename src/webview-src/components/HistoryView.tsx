import { useRef, useState, useMemo } from 'react';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';
import { Tooltip } from './Tooltip';

// --- Constants ---

const PROMPT_PREVIEW_MAX_LENGTH = 500;
const HISTORY_PAGE_SIZE = 30;

// --- Types ---

interface Conversation {
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
  contextTokens?: number;
}

interface HistoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  animationDelay: number;
  onSelect: () => void;
  onDelete: () => void;
}

// --- Utility Functions ---

/**
 * Generates the display title for a conversation.
 * Uses the server-provided title if available, otherwise falls back to
 * "Conversation (first 5 digits of ID)" for local conversations.
 */
function getDisplayTitle(conversation: Conversation): string {
  if (conversation.title) {
    return conversation.title;
  }
  const shortId = conversation.id.slice(0, 5);
  return `Conversation (${shortId})`;
}

/**
 * Generates a preview of the initial user prompt.
 * Returns the first 100 characters with ellipsis if truncated.
 */
function getPromptPreview(firstMessage?: string): string | null {
  if (!firstMessage) {
    return null;
  }
  if (firstMessage.length <= PROMPT_PREVIEW_MAX_LENGTH) {
    return firstMessage;
  }
  return `${firstMessage.slice(0, PROMPT_PREVIEW_MAX_LENGTH)}…`;
}

/**
 * Formats a timestamp as a relative time string (e.g., "2h ago").
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// --- Components ---

/**
 * Renders a single conversation item in the history list.
 * Displays title (clickable), prompt preview, and metadata.
 */
function ConversationItem({
  conversation,
  isActive,
  animationDelay,
  onSelect,
  onDelete,
}: ConversationItemProps) {
  const displayTitle = getDisplayTitle(conversation);
  const promptPreview = getPromptPreview(conversation.firstMessage);
  const timeAgo = formatTimeAgo(conversation.timestamp);
  const contextTokens = typeof conversation.contextTokens === 'number' ? conversation.contextTokens : 0;

  return (
    <div
      className="relative animate-slide-up"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <button
        onClick={onSelect}
        className={`
          w-full text-left p-4 pr-12 rounded-xl
          transition-all duration-200
          border
          hover:bg-white/[0.04]
          oh-focus-outline
          ${isActive
            ? 'bg-brand-500/10 border-white/[0.06] oh-outline-soft hover:bg-brand-500/15 hover:border-white/[0.08]'
            : 'bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08]'}
        `}
      >
        {/* Title Row */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className={`font-medium text-sm line-clamp-2 flex-1 ${isActive ? 'text-brand-200' : 'text-stone-200'}`}>
            {displayTitle}
          </div>
          {isActive && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-400 mt-1 animate-pulse" />
          )}
        </div>

        {/* Prompt Preview */}
        {promptPreview && (
          <div className="text-xs text-stone-500 line-clamp-5 mb-2">
            {promptPreview}
          </div>
        )}

        {/* Metadata Row */}
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <span className="flex items-center gap-1">
            <span className="codicon codicon-clock" />
            {timeAgo}
          </span>
          {conversation.messageCount !== undefined && (
            <span className="flex items-center gap-1">
              <span className="codicon codicon-comment" />
              {conversation.messageCount}
            </span>
          )}
        </div>

        <div className="mt-1 text-xs text-stone-500 flex items-center gap-1.5">
          <span>Context:</span>{' '}
          <span className="font-mono text-stone-300">{contextTokens}</span>{' '}
          <span>tokens</span>
        </div>
      </button>

      <div className="absolute right-3 top-4">
        <Tooltip content={isActive ? 'Cannot delete active conversation' : 'Delete conversation'} position="left">
          <button
            type="button"
            onClick={onDelete}
            disabled={isActive}
            className={`h-7 w-7 rounded-md text-stone-500 flex items-center justify-center transition-all ${isActive
              ? 'opacity-40 cursor-not-allowed'
              : 'hover:text-stone-200 hover:bg-white/[0.06]'}`}
            aria-label="Delete conversation"
          >
            <span className="codicon codicon-trash text-sm" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Renders the empty state when no conversations exist.
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <span className="codicon codicon-inbox text-4xl mb-4 text-stone-600" />
      <p className="text-sm text-stone-400">No conversation history yet</p>
      <p className="text-xs mt-2 text-stone-500">
        Start a new conversation to begin
      </p>
    </div>
  );
}

/**
 * Renders the empty state when no conversations match the search query.
 */
function NoResultsState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <span className="codicon codicon-search text-4xl mb-4 text-stone-600" />
      <p className="text-sm text-stone-300">No matches</p>
      <p className="text-xs mt-2 text-stone-500">
        Nothing matched <span className="font-mono text-stone-400">{query}</span>
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-300 hover:bg-white/[0.08] hover:text-stone-100 transition-all"
      >
        <span className="codicon codicon-clear-all" />
        Clear search
      </button>
    </div>
  );
}

/**
 * Main history view component that displays a list of past conversations
 * in a full-width panel.
 */
export function HistoryView({
  isOpen,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
}: HistoryViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

  // Close on Escape key or click outside (with delay to avoid immediate close on open)
  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: panelRef, delay: 100 });

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.timestamp - a.timestamp),
    [conversations]
  );
  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sortedConversations;
    }
    return sortedConversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.firstMessage,
        conversation.id,
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [sortedConversations, query]);

  const hasAnyQuery = query.length > 0;
  const visibleConversations = useMemo(
    () => filteredConversations.slice(0, visibleCount),
    [filteredConversations, visibleCount]
  );
  const canLoadMore = visibleConversations.length < filteredConversations.length;

  const updateQuery = (next: string) => {
    setQuery(next);
    setVisibleCount(HISTORY_PAGE_SIZE);
  };

  const footerText = useMemo(() => {
    const trimmedQuery = query.trim();
    const totalConversations = sortedConversations.length;
    const visible = visibleConversations.length;

    if (trimmedQuery) {
      const matchWord = filteredConversations.length === 1 ? 'match' : 'matches';
      return `Showing ${visible} of ${filteredConversations.length} ${matchWord} (${totalConversations} total)`;
    }

    const conversationWord = totalConversations === 1 ? 'conversation' : 'conversations';
    if (canLoadMore) {
      return `Showing ${visible} of ${totalConversations} ${conversationWord}`;
    }
    return `${totalConversations} ${conversationWord}`;
  }, [canLoadMore, filteredConversations.length, query, sortedConversations.length, visibleConversations.length]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="Conversation History" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative ml-auto w-full max-w-5xl h-full bg-[var(--vscode-editor-background)] border-l border-white/[0.08] shadow-2xl flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="text-2xl" aria-label="OpenHands">
              🙌
            </div>
            <h2 className="font-semibold text-base leading-tight text-stone-100">OpenHands - History</h2>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:text-stone-100 hover:bg-white/[0.08] transition-all flex items-center justify-center oh-focus-outline"
            aria-label="Close history"
            title="Close"
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative max-w-2xl">
            <span className="codicon codicon-search absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && hasAnyQuery) {
                  e.stopPropagation();
                  updateQuery('');
                }
              }}
              placeholder="Search history…"
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-0 focus:border-white/[0.08] focus:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]"
              aria-label="Search conversation history"
            />
            {hasAnyQuery && (
              <button
                type="button"
                onClick={() => updateQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-stone-400 hover:text-stone-200 hover:bg-white/[0.06] flex items-center justify-center transition-all"
                aria-label="Clear search"
                title="Clear search"
              >
                <span className="codicon codicon-close" />
              </button>
            )}
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sortedConversations.length === 0 ? (
            <EmptyState />
          ) : filteredConversations.length === 0 ? (
            <NoResultsState query={query.trim()} onClear={() => updateQuery('')} />
          ) : (
            <div className="space-y-2 max-w-2xl">
              {visibleConversations.map((conversation, index) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === currentConversationId}
                  animationDelay={index * 30}
                  onSelect={() => {
                    onSelectConversation(conversation.id);
                    onClose();
                  }}
                  onDelete={() => onDeleteConversation(conversation.id)}
                />
              ))}

              {canLoadMore && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + HISTORY_PAGE_SIZE)}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-stone-300 hover:bg-white/[0.06] hover:text-stone-100 hover:border-white/[0.1] transition-all"
                    aria-label="Load more conversations"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.08] bg-white/[0.02]">
          <p className="text-xs text-stone-500 text-center">
            {footerText}
          </p>
        </div>
      </div>
    </div>
  );
}
