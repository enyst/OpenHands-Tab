import { useRef, useState } from 'react';
import { useCloseOnEscapeAndOutsideClick, type CloseReason } from '../useCloseOnEscapeAndOutsideClick';

interface Skill {
  label: string;
  path: string;
}

interface SkillsPopoverProps {
  isOpen: boolean;
  onClose: (reason: CloseReason) => void;
  skills: Skill[];
  onOpenSkill: (path: string) => void;
}

export function SkillsPopover({
  isOpen,
  onClose,
  skills,
  onOpenSkill,
}: SkillsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  const filteredSkills = skills.filter((skill) => skill.label.toLowerCase().includes(searchQuery.toLowerCase()));

  const listboxId = 'skills-picker-listbox';
  const safeActiveIndex = filteredSkills.length > 0 ? Math.min(activeIndex, filteredSkills.length - 1) : 0;
  const activeOptionId = filteredSkills.length > 0 ? `skills-picker-option-${safeActiveIndex}` : undefined;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(() => Math.min(safeActiveIndex + 1, Math.max(filteredSkills.length - 1, 0)));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(() => Math.max(safeActiveIndex - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      const skill = filteredSkills[safeActiveIndex];
      if (!skill) return;
      e.preventDefault();
      onOpenSkill(skill.path);
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
      className="absolute bottom-full left-0 mb-1 w-64 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
      style={{
        background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-mortar-board text-brand-400" />
          <h3 className="font-semibold text-sm text-stone-200">Available Skills</h3>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search skills..."
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-lg text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 focus:border-brand-500/40"
          autoFocus
        />
      </div>

      {/* Skills list */}
      <div className="overflow-y-auto max-h-64">
        {filteredSkills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">No skills found</div>
        ) : (
          <div className="p-2 space-y-0.5" role="listbox" aria-label="Skills" id={listboxId}>
            {filteredSkills.map((skill, index) => {
              const isActive = index === safeActiveIndex;
              return (
                <button
                  key={skill.path}
                  onClick={() => onOpenSkill(skill.path)}
                  role="option"
                  id={`skills-picker-option-${index}`}
                  aria-label={skill.label}
                  aria-selected="false"
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm
                    transition-all duration-150
                    flex items-center gap-2
                    group
                    ${isActive
                      ? 'bg-brand-500/10 text-stone-200 ring-1 ring-brand-500/40'
                      : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300'
                    }
                  `}
                  data-active={isActive ? 'true' : 'false'}
                >
                  <span className="codicon codicon-file-code text-brand-400/70" />
                  <span className="flex-1 truncate">{skill.label}</span>
                  <span className="codicon codicon-arrow-right text-stone-600 group-hover:text-stone-400 transition-colors" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

