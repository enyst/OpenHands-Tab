import type { ComponentProps } from 'react';
import { InputArea } from '../InputArea';
import { StatusBanner } from '../StatusBanner';
import type { StatusBannerState } from './useStatusMessages';

export function ConversationInputDock(props: {
  inputAreaProps: ComponentProps<typeof InputArea>;
  statusBanner: StatusBannerState | null;
  onDismissStatusBanner: () => void;
  agentStatus?: string;
  onStopAgent?: () => void;
}) {
  const { inputAreaProps, statusBanner, onDismissStatusBanner, agentStatus, onStopAgent } = props;

  const isRunning = agentStatus === 'RUNNING';

  return (
    <div className="relative">
      {/* Stop button - shown when agent is running */}
      {isRunning && onStopAgent && (
        <button
          type="button"
          onClick={onStopAgent}
          className="
            w-full px-4 py-3
            flex items-center justify-center gap-2
            bg-gradient-to-r from-red-500/15 to-red-600/10
            border-t border-b border-red-500/20
            text-red-300 hover:text-red-200
            hover:from-red-500/20 hover:to-red-600/15
            transition-all duration-200
            text-sm font-medium
          "
          aria-label="Stop the agent"
          data-testid="stop-agent-button"
        >
          <span className="codicon codicon-debug-stop" />
          <span>Stop the agent</span>
        </button>
      )}

      <InputArea {...inputAreaProps} />

      {/* Bottom status bar (below prompt + controls) */}
      <div
        className="px-4 pt-2 pb-2 bg-[var(--vscode-editor-background)]/95 backdrop-blur-md min-h-16"
        data-testid="status-row"
      >
        {statusBanner && (
          <StatusBanner
            message={statusBanner.message}
            level={statusBanner.level}
            dismissible={statusBanner.dismissible}
            onDismiss={onDismissStatusBanner}
            autoDismiss={statusBanner.autoDismiss ?? statusBanner.level !== 'error'}
            autoDismissDelay={statusBanner.autoDismissDelay}
          />
        )}
      </div>
    </div>
  );
}

