import { useState } from 'react';
import { ServerSelector, getServerDisplayLabel, type SavedServer } from './ServerSelector';

interface HeaderProps {
  status: 'online' | 'offline' | 'connecting';
  mode: 'local' | 'remote';
  conversationId?: string;
  currentServerUrl?: string;
  servers: SavedServer[];
  onNewConversation: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onReconnect: () => void;
  onSelectServer: (url: string) => void;
  onAddServer: (server: SavedServer) => void;
  onRemoveServer: (url: string) => void;
  onSwitchToLocal: () => void;
}

function StatusIndicator({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  const statusConfig = {
    online: {
      color: '#059669',
      label: 'Connected',
      icon: 'pass',
      animate: false,
    },
    offline: {
      color: '#DC2626',
      label: 'Disconnected',
      icon: 'error',
      animate: false,
    },
    connecting: {
      color: '#3B82F6',
      label: 'Connecting',
      icon: 'sync',
      animate: true,
    },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-effect">
      <div
        className={`w-2 h-2 rounded-full ${config.animate ? 'animate-pulse-glow' : ''}`}
        style={{ backgroundColor: config.color }}
        aria-label={`Status: ${config.label}`}
      />
      <span className="text-xs font-medium opacity-90">{config.label}</span>
    </div>
  );
}

function HeaderButton({
  icon,
  label,
  onClick,
  disabled = false,
  variant = 'default',
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary';
}) {
  const baseClasses = `
    relative inline-flex items-center justify-center
    h-9 px-3 rounded-lg
    text-sm font-medium
    transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-brand-500/50
    disabled:opacity-40 disabled:cursor-not-allowed
  `;

  const variantClasses = variant === 'primary'
    ? 'bg-brand-500/20 text-brand-300 hover:bg-brand-500/30 hover:shadow-glow-sm'
    : 'bg-white/5 hover:bg-white/10 hover:shadow-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses}`}
      aria-label={label}
      title={label}
    >
      <span className={`codicon codicon-${icon} mr-2`} />
      <span>{label}</span>
    </button>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  statusDot,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  statusDot?: { color: string; animate?: boolean };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        relative inline-flex items-center justify-center
        h-9 w-9 rounded-lg
        bg-white/5 hover:bg-white/10
        transition-all duration-200
        hover:shadow-sm hover:scale-105
        focus:outline-none focus:ring-2 focus:ring-brand-500/50
        disabled:opacity-40 disabled:cursor-not-allowed
      `}
      aria-label={label}
      title={label}
    >
      <span className={`codicon codicon-${icon} text-base`} />
      {statusDot && (
        <span
          className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--vscode-editor-background)] ${statusDot.animate ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: statusDot.color }}
        />
      )}
    </button>
  );
}

export function Header({
  status,
  mode,
  conversationId,
  currentServerUrl,
  servers,
  onNewConversation,
  onOpenHistory,
  onOpenSettings,
  onReconnect,
  onSelectServer,
  onAddServer,
  onRemoveServer,
  onSwitchToLocal,
}: HeaderProps) {
  const [showServerSelector, setShowServerSelector] = useState(false);

  // Get display name using shared helper for consistency
  const getServerDisplayName = () => {
    if (mode === 'local') return 'Local Mode';
    if (!currentServerUrl) return 'No Server';
    const server = servers.find(s => s.url === currentServerUrl);
    if (server) return getServerDisplayLabel(server);
    // Fallback for URL not in servers list
    try {
      const url = new URL(currentServerUrl);
      return url.hostname + (url.port ? ':' + url.port : '');
    } catch {
      return currentServerUrl;
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--vscode-editor-background)]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 gap-4">
        {/* Left side - Logo & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="text-2xl" aria-label="OpenHands">
              🙌
            </div>
            <div>
              <div className="font-semibold text-base leading-tight">OpenHands</div>
              {conversationId && (
                <div className="text-xs opacity-50 font-mono leading-tight">
                  {conversationId.slice(0, 8)}
                </div>
              )}
            </div>
          </div>

          {/* Server selector button - shows current server/mode */}
          <div className="relative">
            <button
              onClick={() => setShowServerSelector(!showServerSelector)}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full
                text-xs font-medium
                transition-all duration-200
                hover:bg-white/10
                ${mode === 'local'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'glass-effect'}
              `}
              title="Select server"
            >
              <span className={`codicon codicon-${mode === 'local' ? 'device-desktop' : 'cloud'}`} />
              <span className="max-w-24 truncate">{getServerDisplayName()}</span>
              <span className="codicon codicon-chevron-down text-[10px] opacity-60" />
            </button>

            <ServerSelector
              isOpen={showServerSelector}
              onClose={() => setShowServerSelector(false)}
              servers={servers}
              currentServerUrl={currentServerUrl}
              mode={mode}
              onSelectServer={onSelectServer}
              onAddServer={onAddServer}
              onRemoveServer={onRemoveServer}
              onSwitchToLocal={onSwitchToLocal}
            />
          </div>

          {/* Status indicator - only show for remote mode */}
          {mode === 'remote' && <StatusIndicator status={status} />}
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-2">
          <HeaderButton
            icon="add"
            label="New"
            onClick={onNewConversation}
            variant="primary"
          />

          <div className="w-px h-6 bg-white/10" />

          <IconButton
            icon="history"
            label="History"
            onClick={onOpenHistory}
          />

          <IconButton
            icon="settings-gear"
            label="Settings"
            onClick={onOpenSettings}
          />

          {status === 'offline' && (
            <IconButton
              icon="sync"
              label="Reconnect"
              onClick={onReconnect}
              statusDot={{ color: '#DC2626' }}
            />
          )}

          {status === 'connecting' && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-300 text-sm">
              <span className="codicon codicon-sync animate-spin" />
              <span>Connecting...</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
