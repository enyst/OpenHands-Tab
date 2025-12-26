import { useRef } from 'react';
import { useCloseOnEscapeAndOutsideClick, type CloseReason } from '../useCloseOnEscapeAndOutsideClick';

interface ToolDescriptor {
  id: string;
  label: string;
}

interface ToolsPopoverProps {
  isOpen: boolean;
  onClose: (reason: CloseReason) => void;
  tools: ToolDescriptor[];
  enabledToolIds: string[];
  onToggleTool: (toolId: string) => void;
}

export function ToolsPopover({
  isOpen,
  onClose,
  tools,
  enabledToolIds,
  onToggleTool,
}: ToolsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-1 w-64 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
      style={{
        background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
      }}
    >
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-tools text-brand-400" />
          <h3 className="font-semibold text-sm text-stone-200">Tools</h3>
        </div>
        <div className="mt-1 text-xs text-stone-500">Select which tools the agent can use</div>
      </div>

      <div className="overflow-y-auto max-h-64">
        {tools.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">No tools available</div>
        ) : (
          <div className="p-2 space-y-0.5" role="listbox" aria-label="Tools">
            {tools.map((tool) => {
              const isEnabled = enabledToolIds.includes(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onToggleTool(tool.id)}
                  role="option"
                  aria-label={tool.label}
                  aria-selected={isEnabled ? 'true' : 'false'}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm
                    transition-all duration-150
                    flex items-center gap-2
                    group
                    ${isEnabled
                      ? 'bg-brand-500/10 text-stone-200'
                      : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300'
                    }
                  `}
                >
                  <span className="codicon codicon-symbol-method text-brand-400/70" />
                  <span className="flex-1 truncate">{tool.label}</span>
                  {isEnabled && <span className="codicon codicon-check text-brand-400" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

