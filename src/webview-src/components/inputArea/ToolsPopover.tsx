import { useEffect, useRef, useState } from 'react';
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
  const listboxRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => listboxRef.current?.focus());
  }, [isOpen]);

  const safeActiveIndex = tools.length > 0 ? Math.min(activeIndex, tools.length - 1) : -1;
  const activeOptionId = safeActiveIndex >= 0 ? `tools-picker-option-${safeActiveIndex}` : undefined;

  const handleListboxKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose('escape');
      return;
    }

    if (tools.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, tools.length - 1)));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < 0 ? tools.length - 1 : Math.max(prev - 1, 0)));
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(tools.length - 1);
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      const tool = tools[safeActiveIndex < 0 ? 0 : safeActiveIndex];
      if (!tool) return;
      e.preventDefault();
      onToggleTool(tool.id);
    }
  };

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
          <div
            ref={listboxRef}
            className="p-2 space-y-0.5 focus:outline-none oh-focus-outline"
            role="listbox"
            aria-label="Tools"
            aria-activedescendant={activeOptionId}
            tabIndex={0}
            onKeyDown={handleListboxKeyDown}
          >
            {tools.map((tool, index) => {
              const isEnabled = enabledToolIds.includes(tool.id);
              const isActive = index === safeActiveIndex;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onToggleTool(tool.id)}
                  role="option"
                  id={`tools-picker-option-${index}`}
                  aria-label={tool.label}
                  aria-selected={isEnabled ? 'true' : 'false'}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm
                    transition-all duration-150
                    flex items-center gap-2
                    group
                    ${isEnabled ? 'bg-brand-500/10 text-stone-200 oh-outline-soft' : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300'}
                    ${isActive && !isEnabled ? 'bg-white/[0.04] text-stone-200 oh-outline-soft' : ''}
                    ${isActive && isEnabled ? 'bg-brand-500/15' : ''}
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
