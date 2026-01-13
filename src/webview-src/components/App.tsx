import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isMessageEvent,
  type Event,
  type ActionEvent,
} from '@openhands/agent-sdk-ts';
import { normalizeHalUserName } from '../../shared/halScript';
import { getVscodeApi } from '../shared/vscodeApi';
import { MAX_PASTED_IMAGE_BYTES, MAX_PASTED_IMAGES } from '../../shared/pasteLimits';
import { escapeMarkdownAltText } from './app/pastedImages';
import { INITIAL_CONVERSATION_TOTALS, type ConversationTotals } from './app/conversationTotals';
import { useHalFlow } from './app/useHalFlow';
import { useInlineImageAttachments } from './app/useInlineImageAttachments';
import { useStatusMessages } from './app/useStatusMessages';
import { useHostMessages } from './app/useHostMessages';
import { useConversationEvents } from './app/useConversationEvents';
import { useLlmProfilesRequests } from './app/useLlmProfilesRequests';
import { useWebviewReady } from './app/useWebviewReady';
import { ConversationPane } from './app/ConversationPane';
import { ConversationInputDock } from './app/ConversationInputDock';

// Component imports
import { Header } from './Header';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { HistoryView } from './HistoryView';
import { LlmProfilesView, type LlmProfilesViewOpenRequest } from './LlmProfilesView';
import type { HalPhase } from '../../shared/halTypes';
import { HalOverlay } from './HalOverlay';
import type { WebviewToHostMessage } from '../../shared/webviewMessages';

type RenderedEvent = { id: number; event: Event };

/**
 * Main App component: React webview root for OpenHands extension.
 */
export function App() {
  // Connection state
  const [status, setStatus] = useState<'online' | 'offline' | 'connecting'>('offline');
  const [mode, setMode] = useState<'local' | 'remote'>('remote');
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [llmProfileId, setLlmProfileId] = useState<string | null>(null);
  const [llmProfiles, setLlmProfiles] = useState<string[]>([]);

  // Events and conversation state
  const [events, setEvents] = useState<RenderedEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [pendingActions, setPendingActions] = useState<ActionEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [conversationTotals, setConversationTotals] = useState<ConversationTotals>(INITIAL_CONVERSATION_TOTALS);
  const eventId = useRef(1);

  // Input state
  const [input, setInput] = useState('');
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ uri: string; label: string; sizeBytes?: number }>>([]);

  // UI state
  const { statusBanner, setStatusBanner, showStatusMessage } = useStatusMessages({ message: 'Initializing…', level: 'info' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLlmProfiles, setShowLlmProfiles] = useState(false);
  const [llmProfilesOpenRequest, setLlmProfilesOpenRequest] = useState<LlmProfilesViewOpenRequest | null>(null);

  // Context picker state
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [isMentionActive, setIsMentionActive] = useState(false);
  const mentionStartRef = useRef<number | null>(null);
  const suppressMentionOnceRef = useRef(false);

  // Skills state
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);

  // Tools state (local mode only)
  const [showToolsPopover, setShowToolsPopover] = useState(false);
  const [tools, setTools] = useState<{ id: string; label: string; description?: string; isDefault?: boolean }[]>([]);
  const [enabledToolIds, setEnabledToolIds] = useState<string[]>([]);

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number }>>([]);

  // Server selection state
  const [servers, setServers] = useState<{ url: string; label?: string }[]>([]);
  const [currentServerUrl, setCurrentServerUrl] = useState<string | undefined>(undefined);

  // Conversation refs (used for HAL + event processing without stale closures)
  const pendingActionsRef = useRef<ActionEvent[]>([]);
  const pendingActionsBatchIdRef = useRef<string | null>(null);
  const agentStatusRef = useRef<string | undefined>(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const currentServerUrlRef = useRef<string | undefined>(undefined);

  // Refs
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLlmUsageRef = useRef(false);
  const uiStateRef = useRef({
    input: '',
    showContextPicker: false,
    showSkillsPopover: false,
    showHistory: false,
    workspaceFilesCount: 0,
    selectedContextFiles: [] as string[],
    skillsCount: 0,
    attachmentsCount: 0,
  });

  // Post message helper
  const postMessage = useCallback((msg: WebviewToHostMessage) => {
    const api = getVscodeApi();
    api.postMessage(msg);
  }, []);

  const {
    pendingLlmProfilesRequestsRef,
    listLlmProfiles,
    loadLlmProfile,
    saveLlmProfile,
    deleteLlmProfile,
    getLlmProfileApiKeyStatus,
    setLlmProfileApiKey,
  } = useLlmProfilesRequests({ postMessage });

  const { inlineImages, setInlineImages, handlePasteImageFiles, handleRemoveInlineImage } = useInlineImageAttachments({
    showStatusMessage,
    maxImages: MAX_PASTED_IMAGES,
    maxBytesPerImage: MAX_PASTED_IMAGE_BYTES,
  });

  // Keep a snapshot for E2E state queries without re-registering message listeners on every keystroke.
  useEffect(() => {
    uiStateRef.current = {
      input,
      showContextPicker,
      showSkillsPopover,
      showHistory,
      workspaceFilesCount: workspaceFiles.length,
      selectedContextFiles: selectedContextFiles.slice(),
      skillsCount: skills.length,
      attachmentsCount: attachments.length,
    };
  }, [attachments.length, input, selectedContextFiles, showContextPicker, showHistory, showSkillsPopover, skills.length, workspaceFiles.length]);

  const handleApprove = useCallback(() => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      showStatusMessage('warn', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'approveAction' });
    showStatusMessage('info', 'Approval submitted');
  }, [isSubmitting, postMessage, showStatusMessage]);

  const handleReject = useCallback((reason?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    submissionTimeoutRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submissionTimeoutRef.current = null;
      showStatusMessage('warn', 'Confirmation timed out - please try again');
    }, 30000);

    postMessage({ type: 'command', command: 'rejectAction', reason });
    showStatusMessage('info', 'Rejection submitted');
  }, [isSubmitting, postMessage, showStatusMessage]);

  const handleStopAgent = useCallback(() => {
    postMessage({ type: 'command', command: 'pause' });
    showStatusMessage('info', 'Stopping agent...');
  }, [postMessage, showStatusMessage]);

  const {
    halSettings,
    applyHalSettings,
    halEnabled,
    halPhase,
    halEye,
    halStepIndex,
    halDecision,
    halLastError,
    halForceRejectInput,
    halTeleporting,
    halVoiceConfirmFallbackKey,
    halSuppressedKey,
    halDialogueLines,
    halStateRef,
    maybeUpdateHalFlow,
    handleStartVoiceConfirm,
    handleStopVoiceConfirm,
    handleCancelVoiceConfirm,
    handleUseButtonsInstead,
    handleHalExit,
    handleHalApprove,
    handleHalReject,
    handleHalTeleport,
    handleHalTtsResponse,
    applyHalVoiceConfirmDecision,
    handleHalVoiceConfirmResponse,
    handleHalTeleportUnavailable,
    handleHalTeleportFailed,
    handleHalTeleportStarting,
    handleHalTeleportCanceled,
    handleHalTeleportSuccess,
    handleConversationStarted,
  } = useHalFlow({
    conversationId,
    conversationIdRef,
    pendingActionsRef,
    agentStatusRef,
    postMessage,
    showStatusMessage,
    handleApprove,
    handleReject,
  });

  useEffect(() => {
    pendingActionsRef.current = pendingActions;
  }, [pendingActions]);

  useEffect(() => {
    agentStatusRef.current = agentStatus;
  }, [agentStatus]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    currentServerUrlRef.current = currentServerUrl;
  }, [currentServerUrl]);

  const { handleEvent } = useConversationEvents({
    agentStatusRef,
    lastAgentStatusRef,
    pendingActionsRef,
    pendingActionsBatchIdRef,
    submissionTimeoutRef,
    hasLlmUsageRef,
    eventId,
    showStatusMessage,
    maybeUpdateHalFlow,
    setAgentStatus,
    setPendingActions,
    setIsSubmitting,
    setStreamingContent,
    setEvents,
    setConversationTotals,
  });

  useWebviewReady({ postMessage });

  useHostMessages({
    applyHalSettings,
    applyHalVoiceConfirmDecision,
    events,
    halStateRef,
    handleConversationStarted,
    handleEvent,
    handleHalApprove,
    handleHalExit,
    handleHalReject,
    handleHalTeleport,
    handleHalTeleportFailed,
    handleHalTeleportUnavailable,
    handleHalTeleportStarting,
    handleHalTeleportCanceled,
    handleHalTeleportSuccess,
    handleHalTtsResponse,
    handleHalVoiceConfirmResponse,
    maybeUpdateHalFlow,
    pendingLlmProfilesRequestsRef,
    postMessage,
    setAgentStatus,
    setAttachments,
    setContextQuery,
    setConversationId,
    setConversationTotals,
    setCurrentServerUrl,
    setEnabledToolIds,
    setEvents,
    setHistory,
    setIsMentionActive,
    setLlmProfileId,
    setLlmProfiles,
    setMode,
    setPendingActions,
    setSelectedContextFiles,
    setServers,
    setShowContextPicker,
    setShowLlmProfiles,
    setLlmProfilesOpenRequest,
    setShowSkillsPopover,
    setShowToolsPopover,
    setSkills,
    setStatus,
    setStatusBanner,
    setStreamingContent,
    setTools,
    setWorkspaceFiles,
    showStatusMessage,
    currentServerUrlRef,
    conversationIdRef,
    pendingActionsRef,
    pendingActionsBatchIdRef,
    agentStatusRef,
    mentionStartRef,
    hasLlmUsageRef,
    eventId,
    uiStateRef,
  });

  // Auto-scroll to bottom when events change or streaming updates
  useEffect(() => {
    const el = endRef.current;
    if (el && 'scrollIntoView' in el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length, streamingContent]);

  // Shared mention detection logic
  const updateMentionState = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');

    // If we intentionally closed the picker (e.g. Esc), avoid reopening immediately on the focus/selection event.
    if (suppressMentionOnceRef.current) {
      suppressMentionOnceRef.current = false;
      if (at !== -1 && !/\s/.test(before.slice(at + 1))) {
        return;
      }
    }

    // Clear mention if no @ or whitespace after @
    if (at === -1 || /\s/.test(before.slice(at + 1))) {
      if (isMentionActive) {
        setIsMentionActive(false);
        setShowContextPicker(false);
        setContextQuery('');
        mentionStartRef.current = null;
      }
      return;
    }

    // Activate mention mode
    const afterAt = before.slice(at + 1);
    mentionStartRef.current = at;
    setIsMentionActive(true);
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
    if (!showContextPicker) {
      postMessage({ type: 'requestWorkspaceFiles' });
      setShowContextPicker(true);
    }
    setContextQuery(afterAt);
  }, [isMentionActive, postMessage, showContextPicker]);

  // Selection tracking from InputArea
  const handleSelectionChange = useCallback((start: number, end: number) => {
    selectionRef.current = { start, end };
    updateMentionState(input, end);
  }, [input, updateMentionState]);

  // Input change with mention detection
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    updateMentionState(value, selectionRef.current.end);
  }, [updateMentionState]);

  // Handler functions
  const handleStartNewConversation = useCallback(() => {
    setStatusBanner({ message: 'Starting new conversation…', level: 'info' });
    setConversationId(undefined);
    setEvents([]);
    setPendingActions([]);
    setAgentStatus(undefined);
    setStreamingContent(null);
    setConversationTotals(INITIAL_CONVERSATION_TOTALS);
    hasLlmUsageRef.current = false;
    eventId.current = 1;
    setInput('');
    setSelectedContextFiles([]);
    setAttachments([]);
    setInlineImages([]);
    setShowToolsPopover(false);
    postMessage({ type: 'command', command: 'startNewConversation' });
  }, [postMessage, setInlineImages, setStatusBanner]);

  const openMainPanel = useCallback((panel: 'history' | 'llmProfiles' | null) => {
    setShowHistory(panel === 'history');
    setShowLlmProfiles(panel === 'llmProfiles');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
  }, [setShowContextPicker, setShowHistory, setShowLlmProfiles, setShowSkillsPopover]);

  const handleOpenHistory = useCallback(() => {
    openMainPanel('history');
    postMessage({ type: 'requestHistory' });
  }, [openMainPanel, postMessage]);

  const handleOpenLlmProfiles = useCallback(() => {
    setLlmProfilesOpenRequest(null);
    openMainPanel('llmProfiles');
  }, [openMainPanel, setLlmProfilesOpenRequest]);

  const handleOpenLlmProfilesCreate = useCallback(() => {
    setLlmProfilesOpenRequest({ mode: 'create' });
    openMainPanel('llmProfiles');
  }, [openMainPanel, setLlmProfilesOpenRequest]);

  const handleOpenLlmProfilesEdit = useCallback((profileId: string) => {
    setLlmProfilesOpenRequest({ mode: 'edit', profileId });
    openMainPanel('llmProfiles');
  }, [openMainPanel, setLlmProfilesOpenRequest]);

  const handleOpenSettings = useCallback(() => {
    postMessage({ type: 'openSettingsPage' });
  }, [postMessage]);

  const handleReconnect = useCallback(() => {
    postMessage({ type: 'command', command: 'reconnect' });
  }, [postMessage]);

  const handleSendMessage = useCallback(() => {
    const text = input.trim();
    const imageMarkdown = inlineImages
      .map((img) => `![${escapeMarkdownAltText(img.label)}](${img.dataUrl})`)
      .join('\n\n');
    const finalText = [text, imageMarkdown].filter(Boolean).join('\n\n');
    if (!finalText) return;

    setInput('');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
    setContextQuery('');
    setSelectedContextFiles([]);
    setAttachments([]);
    setInlineImages([]);
    selectionRef.current = { start: 0, end: 0 };
    postMessage({
      type: 'send',
      text: finalText,
      contextFiles: selectedContextFiles.slice(),
      attachments: attachments.map((a) => a.uri),
    });
  }, [attachments, inlineImages, input, postMessage, selectedContextFiles, setInlineImages]);

  // Context picker handlers
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
  }, [postMessage]);

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

    if (reason !== 'escape') {
      return;
    }

    // When Esc closes the picker, return focus to the input and prevent the mention logic from reopening it.
    setIsMentionActive(false);
    setContextQuery('');
    mentionStartRef.current = null;
    suppressMentionOnceRef.current = true;
    focusInputAtEnd();
  }, [focusInputAtEnd]);

  // Attachments handlers
  const handleOpenAttachments = useCallback(() => {
    postMessage({ type: 'selectAttachments' });
  }, [postMessage]);

  const handleOpenAttachment = useCallback((uri: string) => {
    postMessage({ type: 'openAttachment', uri });
  }, [postMessage]);

  const handleOpenPath = useCallback((p: string) => {
    postMessage({ type: 'openWorkspaceFile', path: p });
  }, [postMessage]);

  const handleRemoveAttachment = useCallback((uri: string) => {
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));
  }, []);

  const handleToggleContextFile = useCallback((file: string) => {
    if (isMentionActive && mentionStartRef.current !== null) {
      // Ensure file is in selected context
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

      // Place caret after inserted mention
      setTimeout(() => {
        const textarea = document.getElementById('openhands-chat-input') as HTMLTextAreaElement | null;
        if (textarea) {
          const pos = (before + inserted).length;
          try { textarea.setSelectionRange(pos, pos); } catch { }
        }
      }, 0);

      // Close mention/context picker
      setIsMentionActive(false);
      setShowContextPicker(false);
      setContextQuery('');
      mentionStartRef.current = null;
    } else {
      setSelectedContextFiles((prev) =>
        prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]
      );
    }
  }, [input, isMentionActive]);

  // Skills handlers
  const handleOpenSkills = useCallback(() => {
    setShowContextPicker(false);
    setShowToolsPopover(false);
    setShowSkillsPopover((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestSkills' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  const handleOpenSkill = useCallback((path: string) => {
    showStatusMessage('info', 'Opening skill…');
    postMessage({ type: 'openSkill', path });
    setShowSkillsPopover(false);
  }, [postMessage, showStatusMessage]);

  const isToolSelectionLocked = events.some((ev) => isMessageEvent(ev.event) && ev.event.source === 'user');

  const handleOpenTools = useCallback(() => {
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setShowToolsPopover((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestTools' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  const handleToggleTool = useCallback((toolId: string) => {
    if (isToolSelectionLocked) {
      showStatusMessage('info', 'To change Tools, please start a new conversation.', { autoDismiss: true, autoDismissDelay: 4000 });
      return;
    }

    if (toolId === 'finish') {
      showStatusMessage('info', 'Finish is always enabled.', { autoDismiss: true, autoDismissDelay: 2500 });
      return;
    }

    setEnabledToolIds((prev) => {
      const known = new Set(tools.map((tool) => tool.id));
      if (!known.has(toolId)) return prev;

      const nextSet = new Set(prev);
      if (nextSet.has(toolId)) nextSet.delete(toolId);
      else nextSet.add(toolId);

      const ordered = tools.map((t) => t.id).filter((id) => nextSet.has(id));
      postMessage({ type: 'setEnabledTools', toolIds: ordered });
      return ordered;
    });
  }, [isToolSelectionLocked, postMessage, showStatusMessage, tools]);

  // History handlers
  const handleSelectConversation = useCallback((id: string) => {
    // No toast on restore; the UI will be repopulated with restored events
    postMessage({ type: 'restoreConversation', id });
  }, [postMessage]);

  const handleDeleteConversation = useCallback((id: string) => {
    if (id === conversationId) return;
    setHistory((prev) => prev.filter((conversation) => conversation.id !== id));
    postMessage({ type: 'deleteConversation', id });
  }, [conversationId, postMessage]);

  // Server selection handlers
  const handleSelectServer = useCallback((url: string) => {
    postMessage({ type: 'selectServer', url });
  }, [postMessage]);

  const handleAddServer = useCallback((server: { url: string; label?: string }) => {
    postMessage({ type: 'addServer', server });
  }, [postMessage]);

  const handleRemoveServer = useCallback((url: string) => {
    postMessage({ type: 'removeServer', url });
  }, [postMessage]);

  const handleSwitchToLocal = useCallback(() => {
    postMessage({ type: 'switchToLocal' });
  }, [postMessage]);

  const handleSelectLlmProfileId = useCallback((profileId: string) => {
    setLlmProfileId(profileId);
    postMessage({ type: 'setLlmProfileId', profileId });
  }, [postMessage]);

  const hasPendingConfirmation = agentStatus === 'WAITING_FOR_CONFIRMATION' && pendingActions.length > 0;
  const hasHighRiskPendingAction = pendingActions.some((action) => action.security_risk === 'HIGH');
  const firstHighRiskAction = pendingActions.find((action) => action.security_risk === 'HIGH');
  const halConversationKey = conversationId ?? 'unknown';
  const voiceConfirmFallbackToButtons =
    halSettings.mode === 'voice_confirm' && halVoiceConfirmFallbackKey === halConversationKey;
  const halSessionKey =
    halEnabled && hasPendingConfirmation && firstHighRiskAction?.tool_call_id
      ? `${conversationId ?? 'unknown'}:${firstHighRiskAction.tool_call_id}`
      : null;
  const shouldShowHalOverlay =
    halEnabled && (
      halPhase === 'waiting_remote' ||
      (hasPendingConfirmation && hasHighRiskPendingAction && halSuppressedKey !== halSessionKey)
    );
  const halUiPhase: HalPhase = halPhase === 'idle' && shouldShowHalOverlay ? 'dialogue' : halPhase;
  const halUiStepIndex = halUiPhase === 'dialogue'
    ? Math.max(0, Math.min(halStepIndex ?? 0, halDialogueLines.length - 1))
    : null;
  const allowHalDebugText = (window as Window & { __OPENHANDS_HAL_DEBUG__?: unknown }).__OPENHANDS_HAL_DEBUG__ === true;
  const halUiLine =
    allowHalDebugText && halUiPhase === 'dialogue' ? halDialogueLines[halUiStepIndex ?? 0]?.text ?? null : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <Header
        status={status}
        mode={mode}
        currentServerUrl={currentServerUrl}
        servers={servers}
        totals={conversationTotals}
        onOpenProfiles={handleOpenLlmProfiles}
        onNewConversation={handleStartNewConversation}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onReconnect={handleReconnect}
        onSelectServer={handleSelectServer}
        onAddServer={handleAddServer}
        onRemoveServer={handleRemoveServer}
        onSwitchToLocal={handleSwitchToLocal}
      />

      <div className="relative flex flex-col flex-1 min-h-0">
        <ConversationPane
          events={events}
          streamingContent={streamingContent}
          skills={skills}
          endRef={endRef}
        />

        {/* HAL overlay (Phase 0: bundled flow replaces confirmation UI) */}
        {shouldShowHalOverlay && (
          <HalOverlay
            key={`hal:${halSessionKey ?? 'none'}:${halForceRejectInput ? 'reject' : 'normal'}`}
            userName={normalizeHalUserName(halSettings.userName)}
            mode={halSettings.mode}
            phase={halUiPhase}
            eye={halEye}
            line={halUiLine}
            decision={halDecision}
            lastError={halLastError}
            isSubmitting={isSubmitting || halTeleporting}
            startWithRejectInput={halForceRejectInput}
            voiceConfirmFallbackToButtons={voiceConfirmFallbackToButtons}
            onStartVoiceConfirm={handleStartVoiceConfirm}
            onStopVoiceConfirm={handleStopVoiceConfirm}
            onCancelVoiceConfirm={handleCancelVoiceConfirm}
            onUseButtonsInstead={handleUseButtonsInstead}
            onApprove={handleHalApprove}
            onTeleport={handleHalTeleport}
            onReject={handleHalReject}
            onExit={() => handleHalExit({ sessionKey: halSessionKey })}
          />
        )}

        {/* Confirmation prompt (modal overlay) */}
        {hasPendingConfirmation && !shouldShowHalOverlay && (
          <ConfirmationPrompt
            pendingActions={pendingActions}
            onApprove={handleApprove}
            onReject={handleReject}
            onOpenPath={handleOpenPath}
            isSubmitting={isSubmitting}
          />
        )}

        {/* Input area */}
        <ConversationInputDock
          inputAreaProps={{
            value: input,
            onChange: handleInputChange,
            onSubmit: handleSendMessage,
            disabled: status === 'offline',
            llmProfileId,
            llmProfiles,
            onSelectLlmProfileId: handleSelectLlmProfileId,
            onOpenLlmProfilesCreate: handleOpenLlmProfilesCreate,
            onOpenLlmProfilesEdit: handleOpenLlmProfilesEdit,
            onOpenContext: handleOpenContext,
            contextCount: selectedContextFiles.length,
            showContextPicker,
            contextPickerFiles: workspaceFiles,
            contextPickerSelectedFiles: selectedContextFiles,
            onToggleContextFile: handleToggleContextFile,
            contextQuery,
            onContextQueryChange: setContextQuery,
            onCloseContextPicker: handleCloseContextPicker,
            onOpenSkills: handleOpenSkills,
            skillsCount: skills.length,
            showSkillsPopover,
            skillsPopoverSkills: skills,
            onOpenSkill: handleOpenSkill,
            onCloseSkillsPopover: () => setShowSkillsPopover(false),
            onOpenTools: mode === 'local' ? handleOpenTools : undefined,
            toolsCount: enabledToolIds.length,
            showToolsPopover,
            toolsPopoverTools: tools,
            enabledToolIds,
            onToggleTool: handleToggleTool,
            onCloseToolsPopover: () => setShowToolsPopover(false),
            onOpenAttachments: handleOpenAttachments,
            attachments,
            onOpenAttachment: handleOpenAttachment,
            onRemoveAttachment: handleRemoveAttachment,
            inlineImages,
            onPasteImageFiles: (files) => { void handlePasteImageFiles(files); },
            onRemoveInlineImage: handleRemoveInlineImage,
            onSelectionChange: handleSelectionChange,
          }}
          statusBanner={statusBanner}
          onDismissStatusBanner={() => setStatusBanner(null)}
          agentStatus={agentStatus}
          onStopAgent={handleStopAgent}
        />
      </div>

      {/* LLM Profiles view (slide-over panel) */}
      <LlmProfilesView
        isOpen={showLlmProfiles}
        activeProfileId={llmProfileId}
        onClose={() => setShowLlmProfiles(false)}
        openRequest={llmProfilesOpenRequest}
        listProfiles={listLlmProfiles}
        loadProfile={loadLlmProfile}
        saveProfile={saveLlmProfile}
        deleteProfile={deleteLlmProfile}
        getApiKeyStatus={getLlmProfileApiKeyStatus}
        setApiKey={setLlmProfileApiKey}
        onSelectActiveProfile={handleSelectLlmProfileId}
      />

      {/* History view (slide-over panel) */}
      <HistoryView
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        conversations={history}
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
      />
    </div>
  );
}
