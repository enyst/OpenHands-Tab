import { useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';

// Re-export for convenience - canonical definition is in SettingsManager
export interface SavedServer {
  url: string;
  label?: string;
}

interface ServerSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  servers: SavedServer[];
  currentServerUrl?: string;
  mode: 'local' | 'remote';
  onSelectServer: (url: string) => void;
  onAddServer: (server: SavedServer) => void;
  onRemoveServer: (url: string) => void;
  onSwitchToLocal: () => void;
}

// Helper to extract display name from server - exported for reuse in Header
export function getServerDisplayLabel(server: SavedServer): string {
  if (server.label) return server.label;
  try {
    const url = new URL(server.url);
    return url.hostname + (url.port ? ':' + url.port : '');
  } catch {
    return server.url;
  }
}

export function ServerSelector({
  isOpen,
  onClose,
  servers,
  currentServerUrl,
  mode,
  onSelectServer,
  onAddServer,
  onRemoveServer,
  onSwitchToLocal,
}: ServerSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  if (!isOpen) return null;

  const handleAddServer = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;

    // Validate URL format
    try {
      new URL(trimmedUrl);
    } catch {
      setUrlError('Invalid URL format');
      return;
    }

    // Check for duplicates
    if (servers.some(s => s.url === trimmedUrl)) {
      setUrlError('Server already exists');
      return;
    }

    setUrlError(null);
    onAddServer({ url: trimmedUrl, label: newLabel.trim() || undefined });
    setNewUrl('');
    setNewLabel('');
    setShowAddForm(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddServer();
    } else if (e.key === 'Escape') {
      setShowAddForm(false);
      setNewUrl('');
      setNewLabel('');
      setUrlError(null);
    }
  };

  const handleCancelAdd = () => {
    setShowAddForm(false);
    setNewUrl('');
    setNewLabel('');
    setUrlError(null);
  };

  // Check if current server is selected (handles both empty string and undefined as "none")
  const isServerSelected = (serverUrl: string) =>
    mode === 'remote' && currentServerUrl === serverUrl;

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 mt-2 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-server text-brand-400" />
          <h3 className="font-semibold text-sm">Server Selection</h3>
        </div>
      </div>

      {/* Server list */}
      <div className="overflow-y-auto max-h-64">
        {/* Local mode option */}
        <div className="p-2 border-b border-white/5">
          <button
            onClick={() => {
              onSwitchToLocal();
              onClose();
            }}
            className={`
              w-full text-left px-3 py-2 rounded-lg
              text-sm
              transition-colors duration-150
              hover:bg-white/10
              flex items-center gap-2
              ${mode === 'local' ? 'bg-brand-500/20 text-brand-300' : ''}
            `}
          >
            <span className="codicon codicon-device-desktop" />
            <span className="flex-1">Local Mode</span>
            {mode === 'local' && (
              <span className="codicon codicon-check text-brand-400" />
            )}
          </button>
        </div>

        {/* Saved servers */}
        {servers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm opacity-60">
            No saved servers
          </div>
        ) : (
          <div className="p-2 space-y-1" role="listbox" aria-label="Servers">
            {servers.map((server) => {
              const selected = isServerSelected(server.url);
              const displayLabel = getServerDisplayLabel(server);
              return (
                <div
                  key={server.url}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg
                    text-sm
                    transition-colors duration-150
                    hover:bg-white/10
                    ${selected ? 'bg-brand-500/20 text-brand-300' : ''}
                  `}
                >
                  <button
                    onClick={() => {
                      onSelectServer(server.url);
                      onClose();
                    }}
                    className="flex-1 text-left flex items-center gap-2"
                    role="option"
                    aria-selected={selected}
                  >
                    <span className="codicon codicon-cloud" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{displayLabel}</div>
                      {server.label && (
                        <div className="text-xs opacity-50 truncate">{server.url}</div>
                      )}
                    </div>
                    {selected && (
                      <span className="codicon codicon-check text-brand-400" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveServer(server.url);
                    }}
                    className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 opacity-50 hover:opacity-100 transition-all"
                    aria-label={`Remove ${displayLabel}`}
                  >
                    <span className="codicon codicon-trash text-xs" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add server form */}
      <div className="border-t border-white/10">
        {showAddForm ? (
          <div className="p-3 space-y-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://server-url..."
              autoFocus
              className={`w-full px-3 py-2 text-sm bg-black/20 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${
                urlError ? 'border-red-500/50' : 'border-white/10'
              }`}
            />
            {urlError && (
              <div className="text-xs text-red-400">{urlError}</div>
            )}
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Label (optional)"
              className="w-full px-3 py-2 text-sm bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddServer}
                disabled={!newUrl.trim()}
                className="flex-1 px-3 py-1.5 text-sm bg-brand-500/20 text-brand-300 rounded-lg hover:bg-brand-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
              <button
                onClick={handleCancelAdd}
                className="px-3 py-1.5 text-sm bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-4 py-3 text-sm text-left hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <span className="codicon codicon-add" />
            <span>Add Server</span>
          </button>
        )}
      </div>
    </div>
  );
}
