import { useRef, useState, useEffect } from 'react';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  // Context picker
  onOpenContext: () => void;
  contextCount?: number;
  // Skills
  onOpenSkills: () => void;
  skillsCount?: number;
  // Attachments (placeholder for future)
  onOpenAttachments?: () => void;
  // MCP (placeholder for future)
  onOpenMCP?: () => void;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask OpenHands anything...',
  onOpenContext,
  contextCount = 0,
  onOpenSkills,
  skillsCount = 0,
  onOpenAttachments,
  onOpenMCP,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200); // Max 200px
    textarea.style.height = `${newHeight}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleSubmit = () => {
    if (!disabled && value.trim()) {
      onSubmit();
    }
  };

  return (
    <div className="sticky bottom-0 z-30 border-t border-white/10 bg-[var(--vscode-editor-background)]/95 backdrop-blur-sm">
      <div className="px-4 py-4">
        {/* Main input container */}
        <div
          className={`
            relative rounded-xl overflow-hidden
            transition-all duration-300
            ${isFocused ? 'shadow-glow ring-2 ring-brand-500/30' : 'shadow-event'}
            ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
          `}
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
          }}
        >
          {/* Textarea */}
          <textarea
            id="openhands-chat-input"
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            className={`
              w-full px-4 py-3 pr-14
              bg-transparent
              text-sm leading-relaxed
              resize-none
              focus:outline-none
              placeholder:opacity-50
              disabled:cursor-not-allowed
            `}
            style={{
              minHeight: '44px',
              maxHeight: '200px',
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className={`
              absolute right-2 bottom-2
              h-9 w-9 rounded-lg
              flex items-center justify-center
              transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-brand-500/50
              ${value.trim() && !disabled
                ? 'bg-brand-500 text-white hover:bg-brand-600 hover:shadow-glow-sm hover:scale-105'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
              }
            `}
            aria-label="Send message"
            title="Send message (Enter)"
          >
            <span className="codicon codicon-send" />
          </button>
        </div>

        {/* Accessory buttons row */}
        <div className="flex items-center gap-2 mt-3">
          <AccessoryButton
            icon="mention"
            label="Add context"
            onClick={onOpenContext}
            badge={contextCount > 0 ? contextCount : undefined}
          />

          <AccessoryButton
            icon="mortar-board"
            label="Skills"
            onClick={onOpenSkills}
            badge={skillsCount > 0 ? skillsCount : undefined}
          />

          {onOpenAttachments && (
            <AccessoryButton
              icon="file"
              label="Attachments"
              onClick={onOpenAttachments}
              comingSoon
            />
          )}

          {onOpenMCP && (
            <AccessoryButton
              icon="server-environment"
              label="MCP Servers"
              onClick={onOpenMCP}
              comingSoon
            />
          )}

          <div className="flex-1" />

          {/* Hint text */}
          <div className="text-xs opacity-40 hidden sm:block">
            <span className="font-mono">Enter</span> to send, <span className="font-mono">Shift+Enter</span> for new line
          </div>
        </div>
      </div>
    </div>
  );
}

interface AccessoryButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  badge?: number;
  comingSoon?: boolean;
}

function AccessoryButton({ icon, label, onClick, badge, comingSoon }: AccessoryButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={comingSoon}
      className={`
        relative inline-flex items-center gap-2
        px-3 py-2 rounded-lg
        text-xs font-medium
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-brand-500/50
        ${comingSoon
          ? 'bg-white/5 text-white/30 cursor-not-allowed'
          : 'bg-white/5 hover:bg-white/10 hover:shadow-sm hover:scale-105'
        }
      `}
      aria-label={label}
      title={label}
    >
      <span className={`codicon codicon-${icon}`} />
      <span>{label}</span>

      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-brand-500 text-white text-[10px] font-semibold flex items-center justify-center">
          {badge}
        </span>
      )}

      {comingSoon && (
        <span className="text-[10px] opacity-60 italic">soon</span>
      )}
    </button>
  );
}

{/* Context Picker Popover */}
interface ContextPickerProps {
  isOpen: boolean;
  onClose: () => void;
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

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 100);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredFiles = files.filter((file) =>
    file.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-16 left-4 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/20 rounded-xl shadow-2xl overflow-hidden animate-scale-in z-50"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2 mb-2">
          <span className="codicon codicon-mention text-brand-400" />
          <h3 className="font-semibold text-sm">Add Context Files</h3>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          autoFocus
        />
      </div>

      {/* File list */}
      <div className="overflow-y-auto max-h-64">
        {filteredFiles.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm opacity-60">
            No matches
          </div>
        ) : (
          <div className="p-2">
            {filteredFiles.map((file) => {
              const isSelected = selectedFiles.includes(file);
              return (
                <button
                  key={file}
                  onClick={() => onToggleFile(file)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg mb-1
                    text-sm font-mono
                    transition-colors duration-150
                    flex items-center gap-2
                    ${isSelected
                      ? 'bg-brand-500/20 text-brand-300'
                      : 'hover:bg-white/5'
                    }
                  `}
                >
                  <span className={`codicon codicon-${isSelected ? 'check' : 'file'}`} />
                  <span className="truncate flex-1">{file}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 bg-white/5 text-xs opacity-70">
          {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}

{/* Skills Popover */}
interface Skill {
  label: string;
  path: string;
}

interface SkillsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
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

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 100);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-16 left-4 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/20 rounded-xl shadow-2xl overflow-hidden animate-scale-in z-50"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-mortar-board text-brand-400" />
          <h3 className="font-semibold text-sm">Available Skills</h3>
        </div>
      </div>

      {/* Skills list */}
      <div className="overflow-y-auto max-h-64">
        {skills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm opacity-60">
            No skills found
          </div>
        ) : (
          <div className="p-2">
            {skills.map((skill) => (
              <button
                key={skill.path}
                onClick={() => onOpenSkill(skill.path)}
                className="
                  w-full text-left px-3 py-2 rounded-lg mb-1
                  text-sm
                  transition-colors duration-150
                  hover:bg-white/10
                  flex items-center gap-2
                "
              >
                <span className="codicon codicon-file-code" />
                <span className="flex-1 truncate">{skill.label}</span>
                <span className="codicon codicon-arrow-right opacity-40" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
