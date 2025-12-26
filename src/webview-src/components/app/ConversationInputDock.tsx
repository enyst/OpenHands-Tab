import type { ComponentProps } from 'react';
import { InputArea } from '../InputArea';
import { StatusBanner } from '../StatusBanner';
import type { StatusBannerState } from './useStatusMessages';

export function ConversationInputDock(props: {
  inputAreaProps: ComponentProps<typeof InputArea>;
  statusBanner: StatusBannerState | null;
  onDismissStatusBanner: () => void;
}) {
  const { inputAreaProps, statusBanner, onDismissStatusBanner } = props;

  return (
    <div className="relative">
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

