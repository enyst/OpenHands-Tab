import { useRef, useState, useEffect } from 'react';
import type { CloseReason } from './useCloseOnEscapeAndOutsideClick';
import { AccessoryButton } from './inputArea/AccessoryButton';
import { ContextPicker } from './inputArea/ContextPicker';
import { LlmProfileSelector } from './inputArea/LlmProfileSelector';
import { SkillsPopover } from './inputArea/SkillsPopover';
import { ToolsPopover } from './inputArea/ToolsPopover';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  // LLM profile selector
  llmProfileId: string | null;
  llmProfiles: string[];
  onSelectLlmProfileId: (profileId: string) => void;
  onOpenLlmProfilesCreate?: () => void;
  onOpenLlmProfilesEdit?: (profileId: string) => void;
  // Context picker
  onOpenContext: () => void;
  contextCount?: number;
  showContextPicker?: boolean;
  contextPickerFiles?: string[];
  contextPickerSelectedFiles?: string[];
  onToggleContextFile?: (file: string) => void;
  contextQuery?: string;
  onContextQueryChange?: (query: string) => void;
  onCloseContextPicker?: (reason: CloseReason) => void;
  // Skills
  onOpenSkills: () => void;
  skillsCount?: number;
  showSkillsPopover?: boolean;
  skillsPopoverSkills?: Array<{ label: string; path: string }>;
  onOpenSkill?: (path: string) => void;
  onCloseSkillsPopover?: (reason: CloseReason) => void;
  // Tools
  onOpenTools?: () => void;
  toolsCount?: number;
  showToolsPopover?: boolean;
  toolsPopoverTools?: Array<{ id: string; label: string }>;
  enabledToolIds?: string[];
  onToggleTool?: (toolId: string) => void;
  toolsReadOnly?: boolean;
  onCloseToolsPopover?: (reason: CloseReason) => void;
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
  // Stop agent (shown when running)
  isRunning?: boolean;
  onStopAgent?: () => void;
  // Queued messages (shown while running)
  queuedMessagesCount?: number;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask OpenHands anything...',
  llmProfileId,
  llmProfiles,
  onSelectLlmProfileId,
  onOpenLlmProfilesCreate,
  onOpenLlmProfilesEdit,
  onOpenContext,
  contextCount = 0,
  showContextPicker = false,
  contextPickerFiles = [],
  contextPickerSelectedFiles = [],
  onToggleContextFile,
  contextQuery = '',
  onContextQueryChange,
  onCloseContextPicker,
  onOpenSkills,
  skillsCount = 0,
  showSkillsPopover = false,
  skillsPopoverSkills = [],
  onOpenSkill,
  onCloseSkillsPopover,
  onOpenTools,
  toolsCount = 0,
  showToolsPopover = false,
  toolsPopoverTools = [],
  enabledToolIds = [],
  onToggleTool,
  toolsReadOnly = false,
  onCloseToolsPopover,
  onOpenAttachments,
  attachments = [],
  onOpenAttachment,
  onRemoveAttachment,
  inlineImages = [],
  onPasteImageFiles,
  onRemoveInlineImage,
  onOpenMCP,
  onSelectionChange,
  isRunning = false,
  onStopAgent,
  queuedMessagesCount = 0,
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
      if (!disabled && (value.trim() || inlineImages.length > 0)) {
        onSubmit();
      }
    }
  };

  const handleSubmit = () => {
    if (!disabled && (value.trim() || inlineImages.length > 0)) {
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
      if (item.type === 'image/svg+xml') continue;
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }

    if (imageFiles.length === 0) return;

    e.preventDefault();
    onPasteImageFiles(imageFiles);
  };

  const canSend = value.trim().length > 0 || inlineImages.length > 0;

  return (
    <div className="z-30 border-t border-white/[0.06] bg-[var(--vscode-editor-background)]/95 backdrop-blur-md">
      <div className="px-4 py-4">
        {/* Main input container */}
        <div
          className={`
            relative rounded-xl overflow-hidden
            transition-all duration-200
            border
            ${isFocused
              ? 'shadow-glow-outline border-white/[0.08]'
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
              w-full px-4 py-3 pr-24
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

            <div className="absolute right-2 bottom-2 flex items-center gap-2">
              {/* Stop button - shown when agent is running */}
              {isRunning && onStopAgent && (
                <button
                  type="button"
                  onClick={onStopAgent}
                  className={`
                    h-9 w-9 rounded-lg
                    flex items-center justify-center
                    transition-all duration-200
                    oh-focus-outline
                    bg-red-500/20 text-red-400 border border-red-500/30
                    hover:bg-red-500/30 hover:border-red-500/40 hover:text-red-300
                  `}
                  aria-label="Stop the agent"
                  title="Stop the agent"
                  data-testid="stop-agent-button"
                >
                  <span className="codicon codicon-debug-stop" />
                </button>
              )}

              {/* Attachments button (icon-only) */}
              {onOpenAttachments && (
                <button
                  type="button"
                  onClick={onOpenAttachments}
                  className={`
                    relative
                    h-9 w-9 rounded-lg
                    flex items-center justify-center
                    transition-all duration-200
                    oh-focus-outline
                    bg-white/[0.06] text-stone-300 border border-white/[0.04]
                    hover:bg-white/[0.08] hover:border-white/[0.1]
                  `}
                  aria-label="Attachments"
                  title="Attachments"
                >
                  <span className="codicon codicon-clippy" />
                  {attachments.length > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white text-[10px] font-semibold flex items-center justify-center shadow-glow-sm">
                      {attachments.length}
                    </span>
                  )}
                </button>
              )}

              {/* Send button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={disabled || !canSend}
                  className={`
                    h-9 w-9 rounded-lg
                    flex items-center justify-center
                    transition-all duration-200
                    oh-focus-outline
                    ${canSend && !disabled
                      ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow-sm hover:from-brand-400 hover:to-brand-500'
                      : 'bg-white/[0.06] text-stone-500 cursor-not-allowed border border-white/[0.04]'
                    }
                  `}
                  aria-label="Send message"
                  title="Send message (Enter)"
                >
                  <span className="codicon codicon-send" />
                </button>

                {isRunning && queuedMessagesCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 text-white text-[10px] font-semibold flex items-center justify-center shadow-glow-sm"
                    title="Queued messages waiting for the agent to finish the current turn"
                    aria-label={`Queued messages: ${queuedMessagesCount}`}
                    role="status"
                    aria-live="polite"
                    data-testid="queued-messages-badge"
                  >
                    {queuedMessagesCount}
                  </span>
                )}
              </div>
            </div>
          </div>

        {/* Accessory buttons row */}
        <div className="flex items-center gap-2 mt-3">
          <div className="relative">
            <AccessoryButton
              label="Add context"
              displayLabel="@"
              onClick={onOpenContext}
              badge={contextCount > 0 ? contextCount : undefined}
            />
            {showContextPicker && onCloseContextPicker && onToggleContextFile && onContextQueryChange && (
              <ContextPicker
                isOpen
                onClose={onCloseContextPicker}
                files={contextPickerFiles}
                selectedFiles={contextPickerSelectedFiles}
                onToggleFile={onToggleContextFile}
                searchQuery={contextQuery}
                onSearchChange={onContextQueryChange}
              />
            )}
          </div>

          <LlmProfileSelector
            profileId={llmProfileId}
            profiles={llmProfiles}
            onSelect={onSelectLlmProfileId}
            onOpenCreate={onOpenLlmProfilesCreate}
            onOpenEdit={onOpenLlmProfilesEdit}
          />

          {onOpenTools && onToggleTool && (
            <div className="relative">
              <AccessoryButton
                icon="tools"
                label="Tools"
                onClick={onOpenTools}
                badge={toolsCount > 0 ? toolsCount : undefined}
              />
              {showToolsPopover && onCloseToolsPopover && (
                <ToolsPopover
                  isOpen
                  onClose={onCloseToolsPopover}
                  tools={toolsPopoverTools}
                  enabledToolIds={enabledToolIds}
                  onToggleTool={onToggleTool}
                  readOnly={toolsReadOnly}
                />
              )}
            </div>
          )}

          <div className="relative">
            <AccessoryButton
              icon="mortar-board"
              label="Skills"
              onClick={onOpenSkills}
              badge={skillsCount > 0 ? skillsCount : undefined}
            />
            {showSkillsPopover && onCloseSkillsPopover && onOpenSkill && (
              <SkillsPopover
                isOpen
                onClose={onCloseSkillsPopover}
                skills={skillsPopoverSkills}
                onOpenSkill={onOpenSkill}
              />
            )}
          </div>

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

export { ContextPicker, SkillsPopover, ToolsPopover };
