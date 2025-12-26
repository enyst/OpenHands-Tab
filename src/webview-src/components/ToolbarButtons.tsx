import React from 'react';
import { Tooltip } from './Tooltip';

const iconButtonBase = 'relative inline-flex h-8 w-8 items-center justify-center rounded-sm bg-[color-mix(in_srgb,var(--vscode-toolbar-background)_92%,transparent)] text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_85%,transparent)] focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)]';
const accessoryButtonBase = 'relative inline-flex h-7 w-7 items-center justify-center rounded-sm bg-transparent text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_35%,transparent)] focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)]';

export interface ToolbarButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  statusClassName?: string;
  iconClassName?: string;
}

export const ToolbarButton: React.FC<ToolbarButtonProps> = React.memo(function ToolbarButton({ icon, label, onClick, disabled, statusClassName, iconClassName }) {
  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        aria-label={label}
        className={`${iconButtonBase} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={onClick}
      >
        <span className={`codicon codicon-${icon} text-sm ${iconClassName ?? ''}`} />
        {statusClassName && (
          <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[var(--vscode-editor-background)] ${statusClassName}`} />
        )}
      </button>
    </Tooltip>
  );
});

export interface AccessoryButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
}

export const AccessoryButton: React.FC<AccessoryButtonProps> = React.memo(function AccessoryButton({ icon, label, onClick }) {
  return (
    <Tooltip content={label} position="bottom">
      <button type="button" aria-label={label} className={accessoryButtonBase} onClick={onClick}>
        <span className={`codicon codicon-${icon}`} />
      </button>
    </Tooltip>
  );
});
