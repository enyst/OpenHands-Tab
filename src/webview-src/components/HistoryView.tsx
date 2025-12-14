import { useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';

// --- Constants ---

const PROMPT_PREVIEW_MAX_LENGTH = 100;

// --- Types ---

interface Conversation {
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
}

interface HistoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (id: string) => void;
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  animationDelay: number;
  onSelect: () => void;
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
}: ConversationItemProps) {
  const displayTitle = getDisplayTitle(conversation);
  const promptPreview = getPromptPreview(conversation.firstMessage);
  const timeAgo = formatTimeAgo(conversation.timestamp);

  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-4 rounded-xl
        transition-all duration-200
        border
        hover:bg-white/[0.04]
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        ${isActive
          ? 'bg-brand-500/10 border-brand-500/25 hover:bg-brand-500/15'
          : 'bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08]'}
        animate-slide-up
      `}
      style={{ animationDelay: `${animationDelay}ms` }}
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
        <div className="text-xs text-stone-500 line-clamp-2 mb-2">
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
    </button>
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
 * in a slide-in side panel.
 */
export function HistoryView({
  isOpen,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
}: HistoryViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  // Close on Escape key or click outside (with delay to avoid immediate close on open)
  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: panelRef, delay: 100 });

  if (!isOpen) return null;

  const sortedConversations = [...conversations].sort((a, b) => b.timestamp - a.timestamp);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredConversations = normalizedQuery
    ? sortedConversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.firstMessage,
        conversation.id,
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    : sortedConversations;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 animate-fade-in"
        aria-hidden="true"
      />

      {/* Side Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full max-w-md border-l border-white/[0.06] shadow-2xl z-50 animate-slide-in-right flex flex-col"
        style={{
          background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
        }}
        role="dialog"
        aria-label="Conversation History"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500/15 flex items-center justify-center">
              <span className="codicon codicon-history text-base text-brand-400" />
            </div>
            <h2 className="text-lg font-semibold text-stone-100">History</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:text-stone-200 hover:bg-white/[0.08] flex items-center justify-center transition-all"
            aria-label="Close history"
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4">
          <div className="relative">
            <span className="codicon codicon-search absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query.trim()) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder="Search history…"
              className="w-full pl-9 pr-9 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0"
              aria-label="Search conversation history"
            />
            {query.trim() && (
              <button
                type="button"
                onClick={() => setQuery('')}
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
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sortedConversations.length === 0 ? (
            <EmptyState />
          ) : filteredConversations.length === 0 ? (
            <NoResultsState query={query.trim()} onClear={() => setQuery('')} />
          ) : (
            <div className="space-y-2">
              {filteredConversations.map((conversation, index) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === currentConversationId}
                  animationDelay={index * 30}
                  onSelect={() => {
                    onSelectConversation(conversation.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] bg-white/[0.02]">
          <p className="text-xs text-stone-500 text-center">
            {query.trim()
              ? `${filteredConversations.length} of ${sortedConversations.length} conversation${sortedConversations.length !== 1 ? 's' : ''}`
              : `${sortedConversations.length} conversation${sortedConversations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>
    </>
  );
}
