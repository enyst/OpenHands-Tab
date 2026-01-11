import { useEffect, useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick, type CloseReason } from '../useCloseOnEscapeAndOutsideClick';

interface ToolDescriptor {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

interface ToolsPopoverProps {
  isOpen: boolean;
  onClose: (reason: CloseReason) => void;
  tools: ToolDescriptor[];
  enabledToolIds: string[];
  onToggleTool: (toolId: string) => void;
}

function ToolButton({
  tool,
  isEnabled,
  isActive,
  onToggle,
  onMouseEnter,
  id,
}: {
  tool: ToolDescriptor;
  isEnabled: boolean;
  isActive: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  id: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={onMouseEnter}
      role="option"
      id={id}
      aria-label={tool.label}
      aria-selected={isEnabled ? 'true' : 'false'}
      className={`
        w-full text-left px-3 py-2.5 rounded-lg
        text-sm
        transition-all duration-150
        flex items-start gap-2.5
        group
        ${isEnabled ? 'bg-brand-500/10 text-stone-200 oh-outline-soft' : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300'}
        ${isActive && !isEnabled ? 'bg-white/[0.04] text-stone-200 oh-outline-soft' : ''}
        ${isActive && isEnabled ? 'bg-brand-500/15' : ''}
      `}
    >
      <span className="codicon codicon-symbol-method text-brand-400/70 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{tool.label}</span>
          {isEnabled && <span className="codicon codicon-check text-brand-400 text-xs" />}
        </div>
        {tool.description && (
          <div className="text-xs text-stone-500 mt-0.5 leading-snug">
            {tool.description}
          </div>
        )}
      </div>
    </button>
  );
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

  // Separate tools into core (default) and additional
  const coreTools = tools.filter((t) => t.isDefault);
  const additionalTools = tools.filter((t) => !t.isDefault);

  // Build a flat list for keyboard navigation indexing
  const allToolsFlat = [...coreTools, ...additionalTools];

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-1 w-72 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
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

      <div
        ref={listboxRef}
        className="overflow-y-auto max-h-80 focus:outline-none oh-focus-outline"
        role="listbox"
        aria-label="Tools"
        aria-activedescendant={activeOptionId}
        tabIndex={0}
        onKeyDown={handleListboxKeyDown}
      >
        {tools.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">No tools available</div>
        ) : (
          <>
            {/* Core Tools */}
            {coreTools.length > 0 && (
              <div className="p-2" role="group" aria-label="Core Tools">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-stone-500">
                  Core Tools
                </div>
                <div className="space-y-0.5">
                  {coreTools.map((tool) => {
                    const globalIndex = allToolsFlat.findIndex((t) => t.id === tool.id);
                    const isEnabled = enabledToolIds.includes(tool.id);
                    const isActive = globalIndex === safeActiveIndex;
                    return (
                      <ToolButton
                        key={tool.id}
                        tool={tool}
                        isEnabled={isEnabled}
                        isActive={isActive}
                        onToggle={() => onToggleTool(tool.id)}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        id={`tools-picker-option-${globalIndex}`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Additional Tools */}
            {additionalTools.length > 0 && (
              <div className="p-2 border-t border-white/[0.04]" role="group" aria-label="Additional Tools">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-stone-500">
                  Additional Tools
                </div>
                <div className="space-y-0.5">
                  {additionalTools.map((tool) => {
                    const globalIndex = allToolsFlat.findIndex((t) => t.id === tool.id);
                    const isEnabled = enabledToolIds.includes(tool.id);
                    const isActive = globalIndex === safeActiveIndex;
                    return (
                      <ToolButton
                        key={tool.id}
                        tool={tool}
                        isEnabled={isEnabled}
                        isActive={isActive}
                        onToggle={() => onToggleTool(tool.id)}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        id={`tools-picker-option-${globalIndex}`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
