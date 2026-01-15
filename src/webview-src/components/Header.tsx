import { useState } from 'react';
import { ServerSelector, getServerDisplayLabel, type SavedServer } from './ServerSelector';
import { Tooltip } from './Tooltip';

interface HeaderProps {
  status: 'online' | 'offline' | 'connecting';
  mode: 'local' | 'remote';
  currentServerUrl?: string;
  servers: SavedServer[];
  totals: {
    contextTokens: number;
    totalCost: number;
    costIsKnown: boolean;
  };
  onOpenProfiles: () => void;
  onNewConversation: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onLoginToServer: () => void;
  onReconnect: () => void;
  onSelectServer: (url: string) => void;
  onAddServer: (server: SavedServer) => void;
  onRemoveServer: (url: string) => void;
  onSwitchToLocal: () => void;
}

function StatusIndicator({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  const statusConfig = {
    online: {
      color: '#34D399',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20',
      label: 'Connected',
      icon: 'pass',
      animate: false,
    },
    offline: {
      color: '#F87171',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/20',
      label: 'Disconnected',
      icon: 'error',
      animate: false,
    },
    connecting: {
      color: '#E8A642',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/20',
      label: 'Connecting',
      icon: 'sync',
      animate: true,
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bgColor} border ${config.borderColor}`}>
      <div
        className={`w-2 h-2 rounded-full ${config.animate ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: config.color }}
        aria-label={`Status: ${config.label}`}
      />
      <span className="text-xs font-medium text-stone-300">{config.label}</span>
    </div>
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
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`
          relative inline-flex items-center justify-center
          h-9 w-9 rounded-lg
          bg-white/[0.04] border border-white/[0.06]
          text-stone-400 hover:text-stone-200
          transition-all duration-200
          hover:bg-white/[0.08] hover:border-white/[0.1]
          oh-focus-outline
          disabled:opacity-40 disabled:cursor-not-allowed
        `}
        aria-label={label}
      >
        <span className={`codicon codicon-${icon} text-base`} />
        {statusDot && (
          <span
            className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--vscode-editor-background)] ${statusDot.animate ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: statusDot.color }}
          />
        )}
      </button>
    </Tooltip>
  );
}

export function Header({
  status,
  mode,
  currentServerUrl,
  servers,
  totals,
  onOpenProfiles,
  onNewConversation,
  onOpenHistory,
  onOpenSettings,
  onLoginToServer,
  onReconnect,
  onSelectServer,
  onAddServer,
  onRemoveServer,
  onSwitchToLocal,
}: HeaderProps) {
  const [showServerSelector, setShowServerSelector] = useState(false);
  const formatInt = (value: number) => Math.max(0, Math.trunc(value)).toLocaleString();
  const formatCost = (value: number) => {
    const clamped = Number.isFinite(value) ? Math.max(0, value) : 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(clamped);
  };

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
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[var(--vscode-editor-background)]/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 py-3 gap-4">
        {/* Left side - Logo & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="text-2xl" aria-label="OpenHands">
              🙌
            </div>
            <div>
              <div className="font-semibold text-base leading-tight text-stone-100">OpenHands</div>
            </div>
          </div>

          {/* Server selector button - shows current server/mode */}
          <div className="relative">
            <Tooltip content="Select server" position="bottom">
              <button
                onClick={() => setShowServerSelector(!showServerSelector)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-lg
                  text-xs font-medium
                  transition-all duration-200
                  ${mode === 'local'
                    ? 'bg-teal-500/15 text-teal-300 border border-teal-500/25 hover:bg-teal-500/20'
                    : 'bg-white/[0.04] text-stone-300 border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.1]'}
                `}
                aria-label="Select server"
              >
                <span className={`codicon codicon-${mode === 'local' ? 'device-desktop' : 'cloud'}`} />
                <span className="max-w-24 truncate">{getServerDisplayName()}</span>
                <span className="codicon codicon-chevron-down text-[10px] opacity-50" />
              </button>
            </Tooltip>

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
          <IconButton icon="add" label="Start new conversation" onClick={onNewConversation} />

          <div className="w-px h-6 bg-white/[0.08]" />

          {mode === 'remote' && Boolean(currentServerUrl?.trim()) && (
            <IconButton icon="key" label="Login to server" onClick={onLoginToServer} />
          )}

          <IconButton
            icon="history"
            label="History"
            onClick={onOpenHistory}
          />

          <IconButton
            icon="symbol-parameter"
            label="LLM Profiles"
            onClick={onOpenProfiles}
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
              statusDot={{ color: '#F87171' }}
            />
          )}

          {status === 'connecting' && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
              <span className="codicon codicon-sync animate-spin" />
              <span>Connecting...</span>
            </div>
          )}
        </div>
      </div>

      <div
        className="px-4 pb-2 text-xs text-stone-500 flex items-center justify-between gap-4"
        data-testid="header-totals-row"
      >
        <div className="flex items-center gap-1.5">
          <span>Context:</span>{' '}
          <span className="font-mono text-stone-300">{formatInt(totals.contextTokens)}</span>{' '}
          <span>tokens</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span>Total cost:</span>{' '}
          <span className="font-mono text-stone-300">
            {totals.costIsKnown ? formatCost(totals.totalCost) : '—'}
          </span>
        </div>
      </div>
    </header>
  );
}
