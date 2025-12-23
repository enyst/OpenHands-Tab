import { useRef, useState, useEffect } from 'react';
import { useCloseOnEscapeAndOutsideClick } from './useCloseOnEscapeAndOutsideClick';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  // LLM profile selector
  llmProfileId: string | null;
  llmProfiles: string[];
  llmProfileLabel?: string | null;
  onSelectLlmProfileId: (profileId: string | null) => void;
  // Context picker
  onOpenContext: () => void;
  contextCount?: number;
  // Skills
  onOpenSkills: () => void;
  skillsCount?: number;
  // Attachments
  onOpenAttachments?: () => void;
  attachments?: Array<{ uri: string; label: string }>;
  onOpenAttachment?: (uri: string) => void;
  onRemoveAttachment?: (uri: string) => void;
  // Inline images (clipboard paste)
  inlineImages?: Array<{ id: string; dataUrl: string; label: string }>;
  onPasteImageFiles?: (files: File[]) => void;
  onRemoveInlineImage?: (id: string) => void;
  // MCP (placeholder for future)
  onOpenMCP?: () => void;
  // Selection tracking (for mention-style context)
  onSelectionChange?: (start: number, end: number) => void;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask OpenHands anything...',
  llmProfileId,
  llmProfiles,
  llmProfileLabel,
  onSelectLlmProfileId,
  onOpenContext,
  contextCount = 0,
  onOpenSkills,
  skillsCount = 0,
  onOpenAttachments,
  attachments = [],
  onOpenAttachment,
  onRemoveAttachment,
  inlineImages = [],
  onPasteImageFiles,
  onRemoveInlineImage,
  onOpenMCP,
  onSelectionChange,
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

  const emitSelection = (el: HTMLTextAreaElement | null) => {
    if (!el || !onSelectionChange) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (typeof start === 'number' && typeof end === 'number') {
      onSelectionChange(start, end);
    }
  };

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

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || !onPasteImageFiles) return;

    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;
      if (typeof item.type !== 'string' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }

    if (imageFiles.length === 0) return;

    e.preventDefault();
    onPasteImageFiles(imageFiles);
  };

  return (
    <div className="sticky bottom-0 z-30 border-t border-white/[0.06] bg-[var(--vscode-editor-background)]/95 backdrop-blur-md">
      <div className="px-4 py-4">
        {/* Main input container */}
        <div
          className={`
            relative rounded-xl overflow-hidden
            transition-all duration-200
            border
            ${isFocused
              ? 'shadow-glow border-brand-500/30 ring-1 ring-brand-500/20'
              : 'shadow-event border-white/[0.06]'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={{
            background: isFocused
              ? 'linear-gradient(135deg, rgba(232, 166, 66, 0.04) 0%, rgba(255, 255, 255, 0.02) 100%)'
              : 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
          }}
        >
          {/* Textarea */}
          <textarea
            id="openhands-chat-input"
            ref={textareaRef}
            value={value}
            onChange={(e) => { onChange(e.target.value); emitSelection(e.currentTarget); }}
            onKeyDown={handleKeyDown}
            onKeyUp={() => emitSelection(textareaRef.current)}
            onClick={() => emitSelection(textareaRef.current)}
            onSelect={() => emitSelection(textareaRef.current)}
            onFocus={() => { setIsFocused(true); emitSelection(textareaRef.current); }}
            onBlur={() => setIsFocused(false)}
            onPaste={handlePaste}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            className={`
              w-full px-4 py-3 pr-14
              bg-transparent
              text-sm leading-relaxed text-stone-200
              resize-none
              focus:outline-none
              placeholder:text-stone-500
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
              focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
              ${value.trim() && !disabled
                ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow-sm hover:from-brand-400 hover:to-brand-500'
                : 'bg-white/[0.06] text-stone-500 cursor-not-allowed border border-white/[0.04]'
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
          <LlmProfileSelector
            profileId={llmProfileId}
            profiles={llmProfiles}
            fallbackLabel={llmProfileLabel}
            onSelect={onSelectLlmProfileId}
          />

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
              badge={attachments.length > 0 ? attachments.length : undefined}
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
          <div className="text-xs text-stone-500 hidden sm:block">
            <span className="font-mono text-stone-400">Enter</span> to send, <span className="font-mono text-stone-400">Shift+Enter</span> for new line
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {attachments.map((a) => (
              <div
                key={a.uri}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-stone-400"
              >
                <button
                  type="button"
                  onClick={() => onOpenAttachment?.(a.uri)}
                  className="inline-flex items-center gap-2 min-w-0 hover:text-stone-300 transition-colors"
                  aria-label={`Open attachment ${a.label}`}
                  title={a.label}
                >
                  <span className="codicon codicon-file text-brand-400/60" />
                  <span className="truncate">{a.label}</span>
                </button>

                {onRemoveAttachment && (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.uri)}
                    className="text-stone-500 hover:text-stone-300 transition-colors"
                    aria-label={`Remove attachment ${a.label}`}
                    title="Remove"
                  >
                    <span className="codicon codicon-close" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {inlineImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {inlineImages.map((img) => (
              <div
                key={img.id}
                className="relative h-16 w-16 rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06]"
                title={img.label}
              >
                <img
                  src={img.dataUrl}
                  alt={img.label}
                  className="h-full w-full object-cover"
                />
                {onRemoveInlineImage && (
                  <button
                    type="button"
                    onClick={() => onRemoveInlineImage(img.id)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-md bg-black/60 text-stone-200 hover:bg-black/70 flex items-center justify-center"
                    aria-label={`Remove pasted image ${img.label}`}
                    title="Remove"
                  >
                    <span className="codicon codicon-close text-[11px]" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
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

interface LlmProfileSelectorProps {
  profileId: string | null;
  profiles: string[];
  fallbackLabel?: string | null;
  onSelect: (profileId: string | null) => void;
}

function LlmProfileSelector({ profileId, profiles, fallbackLabel, onSelect }: LlmProfileSelectorProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose: () => setIsOpen(false), ref: popoverRef, delay: 100 });

  const normalizedFallbackLabel = typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '';
  const hasFallback = normalizedFallbackLabel.length > 0;
  const shown = profileId ?? (hasFallback ? normalizedFallbackLabel : 'None');
  const tooltip = profileId
    ? `LLM profile: ${profileId}`
    : hasFallback
      ? `LLM profile: None (using ${normalizedFallbackLabel})`
      : 'LLM profile: None';
  const sanitizedProfiles = profiles.filter((id) => typeof id === 'string' && id.trim().length > 0);

  const handleSelect = (next: string | null) => {
    onSelect(next);
    setIsOpen(false);
  };

  const isSelected = (candidate: string | null) => candidate === profileId;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`
          inline-flex items-center gap-2
          px-3 py-2 rounded-lg
          text-xs font-medium
          transition-all duration-200
          border
          focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
          bg-white/[0.04] text-stone-400 border-white/[0.06]
          hover:bg-white/[0.08] hover:text-stone-300 hover:border-white/[0.1]
        `}
        aria-label="LLM profile"
        title={tooltip}
      >
        <span className="codicon codicon-symbol-parameter text-[13px] text-brand-400/70" />
        <span className="font-mono text-stone-300 truncate max-w-[14rem]">{shown}</span>
        <span className={`codicon codicon-chevron-${isOpen ? 'up' : 'down'} text-[12px] opacity-70`} />
      </button>

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
            <button
              type="button"
              onClick={() => handleSelect(null)}
              role="option"
              aria-selected={isSelected(null)}
              className={`
                w-full text-left px-3 py-2 rounded-lg
                text-sm
                transition-colors duration-150
                hover:bg-white/10
                flex items-center gap-2
                ${isSelected(null) ? 'bg-brand-500/20 text-brand-300' : 'text-stone-300'}
              `}
            >
              <span className="codicon codicon-circle-slash" />
              <span className="flex-1">None</span>
              {isSelected(null) && <span className="codicon codicon-check text-brand-400" />}
            </button>

            {sanitizedProfiles.length === 0 ? (
              <div className="px-3 py-2 text-sm opacity-60">No profiles found</div>
            ) : (
              sanitizedProfiles.map((id) => {
                const selected = isSelected(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelect(id)}
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
                    <span className="codicon codicon-symbol-misc" />
                    <span className="flex-1 font-mono truncate">{id}</span>
                    {selected && <span className="codicon codicon-check text-brand-400" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
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
        border
        focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0
        ${comingSoon
          ? 'bg-white/[0.02] text-stone-600 border-white/[0.03] cursor-not-allowed'
          : 'bg-white/[0.04] text-stone-400 border-white/[0.06] hover:bg-white/[0.08] hover:text-stone-300 hover:border-white/[0.1]'
        }
      `}
      aria-label={label}
      title={label}
    >
      <span className={`codicon codicon-${icon}`} />
      <span>{label}</span>

      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white text-[10px] font-semibold flex items-center justify-center shadow-glow-sm">
          {badge}
        </span>
      )}

      {comingSoon && (
        <span className="text-[10px] text-stone-600 italic">soon</span>
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

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  if (!isOpen) return null;

  const filteredFiles = files.filter((file) =>
    file.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
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
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-lg text-sm text-stone-200 placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500/30"
          autoFocus
        />
      </div>

      {/* File list */}
      <div className="overflow-y-auto max-h-64">
        {filteredFiles.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">
            No matches
          </div>
        ) : (
          <div className="p-2 space-y-0.5" role="listbox">
            {filteredFiles.map((file) => {
              const isSelected = selectedFiles.includes(file);
              return (
                <button
                  key={file}
                  onClick={() => onToggleFile(file)}
                  role="option"
                  aria-label={file}
                  aria-selected={isSelected ? 'true' : 'false'}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg
                    text-sm font-mono
                    transition-all duration-150
                    flex items-center gap-2
                    ${isSelected
                      ? 'bg-brand-500/15 text-brand-300 border border-brand-500/20'
                      : 'text-stone-400 hover:bg-white/[0.04] hover:text-stone-300 border border-transparent'
                    }
                  `}
                >
                  <span className={`codicon codicon-${isSelected ? 'check' : 'file'} ${isSelected ? 'text-brand-400' : 'text-stone-500'}`} />
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

  useCloseOnEscapeAndOutsideClick({ isOpen, onClose, ref: popoverRef, delay: 100 });

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-[var(--vscode-editor-background)] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden animate-slide-up z-50"
      style={{
        background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="codicon codicon-mortar-board text-violet-400" />
          <h3 className="font-semibold text-sm text-stone-200">Available Skills</h3>
        </div>
      </div>

      {/* Skills list */}
      <div className="overflow-y-auto max-h-64">
        {skills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">
            No skills found
          </div>
        ) : (
          <div className="p-2 space-y-0.5" role="listbox" aria-label="Skills">
            {skills.map((skill) => (
              <button
                key={skill.path}
                onClick={() => onOpenSkill(skill.path)}
                role="option"
                aria-label={skill.label}
                aria-selected="false"
                className="
                  w-full text-left px-3 py-2 rounded-lg
                  text-sm text-stone-400
                  transition-all duration-150
                  hover:bg-white/[0.04] hover:text-stone-300
                  flex items-center gap-2
                  group
                "
              >
                <span className="codicon codicon-file-code text-violet-400/70" />
                <span className="flex-1 truncate">{skill.label}</span>
                <span className="codicon codicon-arrow-right text-stone-600 group-hover:text-stone-400 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
