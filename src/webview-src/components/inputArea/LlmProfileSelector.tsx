import { useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick } from '../useCloseOnEscapeAndOutsideClick';
import { Tooltip } from '../Tooltip';

interface LlmProfileSelectorProps {
  profileId: string | null;
  profiles: string[];
  onSelect: (profileId: string) => void;
  onOpenCreate?: () => void;
  onOpenEdit?: (profileId: string) => void;
}

export function LlmProfileSelector({
  profileId,
  profiles,
  onSelect,
  onOpenCreate,
  onOpenEdit,
}: LlmProfileSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose: () => setIsOpen(false), ref: popoverRef, delay: 100 });

  const sanitizedProfiles = profiles.filter((id) => typeof id === 'string' && id.trim().length > 0);
  const hasProfiles = sanitizedProfiles.length > 0;
  const hasValidSelection = typeof profileId === 'string' && sanitizedProfiles.includes(profileId);
  const selectedProfileId = hasValidSelection ? profileId : null;
  const shouldPromptCreate = selectedProfileId === null && !hasProfiles && Boolean(onOpenCreate);
  const shown = selectedProfileId ?? (hasProfiles ? 'Select profile…' : 'New profile…');
  const tooltip = `LLM profile: ${shown}`;

  const handleSelect = (next: string) => {
    onSelect(next);
    setIsOpen(false);
  };

  const isSelected = (candidate: string) => candidate === selectedProfileId;

  return (
    <div className="relative">
      <Tooltip content={tooltip} position="top">
        <button
          type="button"
          onClick={() => {
            if (shouldPromptCreate && onOpenCreate) {
              onOpenCreate();
              return;
            }
            setIsOpen((prev) => !prev);
          }}
          className={`
            inline-flex items-center gap-2
            px-3 py-2 rounded-lg
            text-xs font-medium
            transition-all duration-200
            border
            focus:outline-none focus:ring-1 focus:ring-brand-500/30 focus:ring-offset-0
            bg-white/[0.04] text-stone-400 border-white/[0.06]
            hover:bg-white/[0.08] hover:text-stone-300 hover:border-white/[0.1]
          `}
          aria-label="LLM profile"
        >
          <span className="codicon codicon-symbol-parameter text-[13px] text-brand-400/70" />
          <span className="font-mono text-stone-300 truncate max-w-[14rem]">{shown}</span>
          <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'} text-[12px] opacity-70`} />
        </button>
      </Tooltip>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 mb-2 w-72 bg-[var(--vscode-editor-background)] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
        >
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="codicon codicon-symbol-parameter text-brand-400" />
              <h3 className="font-semibold text-sm">LLM Profile</h3>
            </div>
          </div>

          <div className="p-2 space-y-1" role="listbox" aria-label="LLM profiles">
            {sanitizedProfiles.length === 0 ? (
              <div className="px-3 py-2 text-sm opacity-60">No profiles found</div>
            ) : (
              sanitizedProfiles.map((id) => {
                const selected = isSelected(id);
                return (
                  <div
                    key={id}
                    role="option"
                    aria-selected={selected}
                    className={`
                      w-full text-left px-3 py-2 rounded-lg
                      text-sm
                      transition-colors duration-150
                      hover:bg-white/10
                      flex items-center gap-2
                      ${selected ? 'bg-brand-500/20 text-brand-300' : 'text-stone-300'}
                    `}
                  >
                    <Tooltip content={`Select profile ${id}`} position="left">
                      <button
                        type="button"
                        onClick={() => handleSelect(id)}
                        className="flex-1 flex items-center gap-2 text-left min-w-0"
                        aria-label={`Select profile ${id}`}
                      >
                        <span className="codicon codicon-symbol-misc" />
                        <span className="flex-1 font-mono truncate">{id}</span>
                      </button>
                    </Tooltip>

                    {selected && onOpenEdit && (
                      <Tooltip content={`Edit profile ${id}`} position="right">
                        <button
                          type="button"
                          onClick={() => {
                            setIsOpen(false);
                            onOpenEdit(id);
                          }}
                          className="h-7 w-7 rounded-md bg-white/[0.03] border border-white/[0.06] text-stone-300 hover:bg-white/[0.08] hover:border-white/[0.1] transition-all flex items-center justify-center"
                          aria-label={`Edit selected profile ${id}`}
                        >
                          <span className="codicon codicon-settings-gear text-[13px]" />
                        </button>
                      </Tooltip>
                    )}

                    {selected && <span className="codicon codicon-check text-brand-400" />}
                  </div>
                );
              })
            )}

            <div className="my-1 border-t border-white/10" />

            <Tooltip content="Create a new LLM profile" position="left">
              <button
                type="button"
                onClick={() => {
                  if (!onOpenCreate) return;
                  setIsOpen(false);
                  onOpenCreate();
                }}
                className={`
                  w-full text-left px-3 py-2 rounded-lg
                  text-sm
                  transition-colors duration-150
                  hover:bg-white/10
                  flex items-center gap-2
                  ${onOpenCreate ? 'text-stone-300' : 'text-stone-500 cursor-not-allowed'}
                `}
                disabled={!onOpenCreate}
                aria-label="New profile…"
              >
                <span className="codicon codicon-add" />
                <span className="flex-1">New profile…</span>
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
