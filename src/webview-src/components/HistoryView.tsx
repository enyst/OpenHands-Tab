import { useRef } from 'react';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';

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
  if (firstMessage.length <= 100) {
    return firstMessage;
  }
  return `${firstMessage.slice(0, 100)}…`;
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
        w-full text-left p-4 rounded-lg
        transition-all duration-200
        border border-transparent
        hover:border-brand-500/30 hover:bg-white/5
        focus:outline-none focus:ring-2 focus:ring-brand-500/50
        ${isActive ? 'bg-brand-500/10 border-brand-500/30' : 'bg-white/5'}
        animate-slide-up
      `}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Title Row */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="font-medium text-sm line-clamp-2 flex-1 text-[var(--vscode-foreground)]">
          {displayTitle}
        </div>
        {isActive && (
          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-400 mt-1" />
        )}
      </div>

      {/* Prompt Preview */}
      {promptPreview && (
        <div className="text-xs opacity-60 line-clamp-2 mb-2">
          {promptPreview}
        </div>
      )}

      {/* Metadata Row */}
      <div className="flex items-center gap-3 text-xs opacity-50">
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
    <div className="flex flex-col items-center justify-center h-full text-center px-8 opacity-60">
      <span className="codicon codicon-inbox text-4xl mb-4 opacity-40" />
      <p className="text-sm">No conversation history yet</p>
      <p className="text-xs mt-2 opacity-70">
        Start a new conversation to begin
      </p>
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

  // Close on Escape key or click outside (with delay to avoid immediate close on open)
  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: panelRef, delay: 100 });

  if (!isOpen) return null;

  const sortedConversations = [...conversations].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-fade-in"
        aria-hidden="true"
      />

      {/* Side Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--vscode-editor-background)] border-l border-white/10 shadow-2xl z-50 animate-slide-in-right flex flex-col"
        role="dialog"
        aria-label="Conversation History"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="codicon codicon-history text-xl text-brand-400" />
            <h2 className="text-lg font-semibold">History</h2>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Close history"
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {sortedConversations.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-2">
              {sortedConversations.map((conversation, index) => (
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
        <div className="px-6 py-4 border-t border-white/10 bg-white/5">
          <p className="text-xs opacity-60 text-center">
            {sortedConversations.length} conversation{sortedConversations.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </>
  );
}
