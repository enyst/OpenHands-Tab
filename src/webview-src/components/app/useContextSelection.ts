import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';

type PostMessage = (msg: WebviewToHostMessage) => void;

interface UseContextSelectionArgs {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  postMessage: PostMessage;
  setShowSkillsPopover: Dispatch<SetStateAction<boolean>>;
  setShowToolsPopover: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns mention-driven context-picker state and handlers so App.tsx stays focused on composition.
 */
export function useContextSelection({
  input,
  setInput,
  postMessage,
  setShowSkillsPopover,
  setShowToolsPopover,
}: UseContextSelectionArgs) {
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [isMentionActive, setIsMentionActive] = useState(false);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const mentionStartRef = useRef<number | null>(null);
  const dismissedMentionStartRef = useRef<number | null>(null);

  const updateMentionState = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');

    const hasWhitespaceAfterAt = at !== -1 && /\s/.test(before.slice(at + 1));
    const isAtTriggerPosition = at === 0 || (at > 0 && /\s/.test(before.charAt(at - 1)));
    const shouldActivateMention = at !== -1 && isAtTriggerPosition && !hasWhitespaceAfterAt;

    if (!shouldActivateMention) {
      if (isMentionActive) {
        setIsMentionActive(false);
        setShowContextPicker(false);
        setContextQuery('');
        mentionStartRef.current = null;
      }
      dismissedMentionStartRef.current = null;
      return;
    }

    if (dismissedMentionStartRef.current === at) {
      if (isMentionActive || showContextPicker) {
        setIsMentionActive(false);
        setShowContextPicker(false);
        setContextQuery('');
        mentionStartRef.current = null;
      }
      return;
    }

    const afterAt = before.slice(at + 1);
    mentionStartRef.current = at;
    dismissedMentionStartRef.current = null;
    setIsMentionActive(true);
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
    if (!showContextPicker) {
      postMessage({ type: 'requestWorkspaceFiles' });
      setShowContextPicker(true);
    }
    setContextQuery(afterAt);
  }, [isMentionActive, postMessage, setShowSkillsPopover, setShowToolsPopover, showContextPicker]);

  const handleSelectionChange = useCallback((start: number, end: number) => {
    selectionRef.current = { start, end };
    updateMentionState(input, end);
  }, [input, updateMentionState]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    updateMentionState(value, selectionRef.current.end);
  }, [setInput, updateMentionState]);

  const handleOpenContext = useCallback(() => {
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
    setShowContextPicker((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestWorkspaceFiles' });
      }
      return willBeOpen;
    });
  }, [postMessage, setShowSkillsPopover, setShowToolsPopover]);

  const focusInputAtEnd = useCallback(() => {
    const textarea = document.getElementById('openhands-chat-input') as HTMLTextAreaElement | null;
    if (!textarea) return;
    textarea.focus();
    const pos = textarea.value.length;
    try {
      textarea.setSelectionRange(pos, pos);
    } catch {
      // ignore
    }
  }, []);

  const handleCloseContextPicker = useCallback((reason: 'escape' | 'outside') => {
    setShowContextPicker(false);

    if (isMentionActive && mentionStartRef.current !== null) {
      dismissedMentionStartRef.current = mentionStartRef.current;
      setIsMentionActive(false);
      setContextQuery('');
      mentionStartRef.current = null;
    }

    if (reason === 'escape') {
      focusInputAtEnd();
    }
  }, [focusInputAtEnd, isMentionActive]);

  const handleToggleContextFile = useCallback((file: string) => {
    if (isMentionActive && mentionStartRef.current !== null) {
      setSelectedContextFiles((prev) => (prev.includes(file) ? prev : [...prev, file]));

      const caret = selectionRef.current.end;
      const start = mentionStartRef.current;
      const before = input.slice(0, start);
      const after = input.slice(caret);
      const mention = `@${file}`;
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
      const inserted = `${needsLeadingSpace ? ' ' : ''}${mention}${needsTrailingSpace ? ' ' : ''}`;
      const next = before + inserted + after;
      setInput(next);

      setTimeout(() => {
        const textarea = document.getElementById('openhands-chat-input') as HTMLTextAreaElement | null;
        if (textarea) {
          const pos = (before + inserted).length;
          try {
            textarea.setSelectionRange(pos, pos);
          } catch {
            // ignore
          }
        }
      }, 0);

      setIsMentionActive(false);
      setShowContextPicker(false);
      setContextQuery('');
      mentionStartRef.current = null;
    } else {
      setSelectedContextFiles((prev) =>
        prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
      );
    }
  }, [input, isMentionActive, setInput]);

  const resetContextSelection = useCallback(() => {
    setShowContextPicker(false);
    setContextQuery('');
    setSelectedContextFiles([]);
    setIsMentionActive(false);
    mentionStartRef.current = null;
    dismissedMentionStartRef.current = null;
    selectionRef.current = { start: 0, end: 0 };
  }, []);

  return {
    showContextPicker,
    setShowContextPicker,
    contextQuery,
    setContextQuery,
    workspaceFiles,
    setWorkspaceFiles,
    selectedContextFiles,
    setSelectedContextFiles,
    isMentionActive,
    setIsMentionActive,
    mentionStartRef,
    handleSelectionChange,
    handleInputChange,
    handleOpenContext,
    handleCloseContextPicker,
    handleToggleContextFile,
    resetContextSelection,
  };
}
