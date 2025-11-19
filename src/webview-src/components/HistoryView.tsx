import { useEffect, useRef } from 'react';

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

export function HistoryView({
  isOpen,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
}: HistoryViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to prevent immediate closing when opening
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

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
            <div className="flex flex-col items-center justify-center h-full text-center px-8 opacity-60">
              <span className="codicon codicon-inbox text-4xl mb-4 opacity-40" />
              <p className="text-sm">No conversation history yet</p>
              <p className="text-xs mt-2 opacity-70">
                Start a new conversation to begin
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedConversations.map((conversation, index) => {
                const isActive = conversation.id === currentConversationId;
                const displayTitle = conversation.title || conversation.firstMessage?.slice(0, 60) || 'Untitled Conversation';
                const timeAgo = formatTimeAgo(conversation.timestamp);

                return (
                  <button
                    key={conversation.id}
                    onClick={() => {
                      onSelectConversation(conversation.id);
                      onClose();
                    }}
                    className={`
                      w-full text-left p-4 rounded-lg
                      transition-all duration-200
                      border border-transparent
                      hover:border-brand-500/30 hover:bg-white/5
                      focus:outline-none focus:ring-2 focus:ring-brand-500/50
                      ${isActive ? 'bg-brand-500/10 border-brand-500/30' : 'bg-white/5'}
                      animate-slide-up
                    `}
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="font-medium text-sm line-clamp-2 flex-1">
                        {displayTitle}
                      </div>
                      {isActive && (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-400 mt-1" />
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs opacity-60">
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

                    {conversation.firstMessage && conversation.firstMessage.length > 60 && (
                      <div className="mt-2 text-xs opacity-50 line-clamp-2">
                        {conversation.firstMessage}
                      </div>
                    )}
                  </button>
                );
              })}
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
