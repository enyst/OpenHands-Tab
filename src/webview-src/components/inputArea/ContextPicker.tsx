import { useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick, type CloseReason } from '../useCloseOnEscapeAndOutsideClick';

interface ContextPickerProps {
  isOpen: boolean;
  onClose: (reason: CloseReason) => void;
  files: string[];
  selectedFiles: string[];
  onToggleFile: (file: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ContextPicker({
  isOpen,
  onClose,
  files,
  selectedFiles,
  onToggleFile,
  searchQuery,
  onSearchChange,
}: ContextPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  const filteredFiles = files.filter((file) => file.toLowerCase().includes(searchQuery.toLowerCase()));

  const listboxId = 'context-picker-listbox';
  const safeActiveIndex = filteredFiles.length > 0 ? Math.min(activeIndex, filteredFiles.length - 1) : 0;
  const activeOptionId = filteredFiles.length > 0 ? `context-picker-option-${safeActiveIndex}` : undefined;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(() => Math.min(safeActiveIndex + 1, Math.max(filteredFiles.length - 1, 0)));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(() => Math.max(safeActiveIndex - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      const file = filteredFiles[safeActiveIndex];
      if (!file) return;
      e.preventDefault();
      onToggleFile(file);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose('escape');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-1 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
      style={{
        background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <span className="codicon codicon-mention text-brand-400" />
          <h3 className="font-semibold text-sm text-stone-200">Add Context Files</h3>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search files..."
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-lg text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-0 focus:border-white/[0.08] focus:shadow-[0_0_0_1px_rgba(232,166,66,0.08)] oh-focus-outline"
          autoFocus
        />
      </div>

      {/* File list */}
      <div className="overflow-y-auto max-h-64">
        {filteredFiles.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">No matches</div>
        ) : (
          <div className="p-2 space-y-0.5" role="listbox" id={listboxId}>
            {filteredFiles.map((file, index) => {
              const isSelected = selectedFiles.includes(file);
              const isActive = index === safeActiveIndex;
              return (
                <button
                  key={file}
                  onClick={() => onToggleFile(file)}
                  role="option"
                  id={`context-picker-option-${index}`}
                  aria-label={file}
                  aria-selected={isSelected ? 'true' : 'false'}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm font-mono
                    transition-all duration-150
                    flex items-center gap-2
                    ${isSelected
                      ? `bg-brand-500/15 text-brand-300${isActive ? ' oh-outline-soft' : ''}`
                      : isActive
                        ? 'bg-brand-500/10 text-stone-200 oh-outline-soft'
                        : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300'
                    }
                  `}
                >
                  <span
                    className={`codicon codicon-${isSelected ? 'check' : 'file'} ${isSelected ? 'text-brand-400' : 'text-stone-500'}`}
                  />
                  <span className="truncate flex-1">{file}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-white/[0.06] bg-brand-500/5 text-xs text-brand-300">
          {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}
