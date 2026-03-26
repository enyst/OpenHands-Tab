import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Event,
  type ActionEvent,
} from '@smolpaws/agent-sdk';
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
import { useContextSelection } from './app/useContextSelection';
import { useSkillsAndTools } from './app/useSkillsAndTools';
import { ConversationPane } from './app/ConversationPane';
import { ConversationInputDock } from './app/ConversationInputDock';
import { getWelcomePromptFlags, type WelcomeSecretStatus } from './app/welcomePrompts';

// Component imports
import { Header } from './Header';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { HistoryView } from './HistoryView';
import { LlmProfilesView, type LlmProfilesViewOpenRequest } from './LlmProfilesView';
import type { HalPhase } from '../../shared/halTypes';
import { HalOverlay } from './HalOverlay';
import type { WebviewToHostMessage } from '../../shared/webviewMessages';

type RenderedEvent = { id: number; event: Event };

const LLM_PROFILE_SWITCH_TIMEOUT_MS = 8000;


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

  // Profile switching is async (host persists settings + applies to runtime).
  // Track in-flight switches so we don't race the next send against the old config.
  const pendingLlmProfileSwitchRef = useRef<string | null>(null);
  const llmProfileSwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedSendAfterLlmProfileSwitchRef = useRef<Array<Extract<WebviewToHostMessage, { type: 'send' }>>>([]);


  // Events and conversation state
  const [events, setEvents] = useState<RenderedEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [pendingActions, setPendingActions] = useState<ActionEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [conversationTotals, setConversationTotals] = useState<ConversationTotals>(INITIAL_CONVERSATION_TOTALS);
  const eventId = useRef(1);

  // Input state
  const [input, setInput] = useState('');
  const [queuedMessagesCount, setQueuedMessagesCount] = useState(0);

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ uri: string; label: string; sizeBytes?: number }>>([]);

  // UI state
  const { statusBanner, setStatusBanner, showStatusMessage } = useStatusMessages({ message: 'Initializing…', level: 'info' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLlmProfiles, setShowLlmProfiles] = useState(false);
  const [llmProfilesOpenRequest, setLlmProfilesOpenRequest] = useState<LlmProfilesViewOpenRequest | null>(null);
  const [welcomeSecretStatus, setWelcomeSecretStatus] = useState<WelcomeSecretStatus>({ hasProviderKey: false, hasGeminiKey: false });

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number; contextTokens?: number }>>([]);

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
    showLlmProfiles: false,
    llmProfileId: null as string | null,
    llmProfiles: [] as string[],
    workspaceFilesCount: 0,
    selectedContextFiles: [] as string[],
    skillsCount: 0,
    attachmentsCount: 0,
    hasWelcomeProviderKey: false,
    hasWelcomeGeminiKey: false,
    showWelcomeProviderKeyMessage: true,
    showWelcomeGeminiKeyMessage: true,
  });

  // Post message helper
  const postMessage = useCallback((msg: WebviewToHostMessage) => {
    // Profile switching is async in the host. Track switches so send can't race the old config.
    if (msg.type === 'setLlmProfileId') {
      const raw = typeof msg.profileId === 'string' ? msg.profileId.trim() : '';
      pendingLlmProfileSwitchRef.current = raw;

      if (llmProfileSwitchTimeoutRef.current) {
        clearTimeout(llmProfileSwitchTimeoutRef.current);
        llmProfileSwitchTimeoutRef.current = null;
      }

      llmProfileSwitchTimeoutRef.current = setTimeout(() => {
        if (pendingLlmProfileSwitchRef.current !== raw) return;
        pendingLlmProfileSwitchRef.current = null;
        llmProfileSwitchTimeoutRef.current = null;

        const queued = queuedSendAfterLlmProfileSwitchRef.current.splice(0);
        if (queued.length > 0) {
          const switchLabel = raw ? `switching LLM profile to '${raw}'` : 'clearing LLM profile';
          showStatusMessage('warn', `Timed out ${switchLabel}. Sending with the current profile.`);
          const api = getVscodeApi();
          for (const queuedMessage of queued) {
            api.postMessage(queuedMessage);
          }
        }
      }, LLM_PROFILE_SWITCH_TIMEOUT_MS);
    }

    // Guard against races where a send happens before the host applied the new settings.
    if (msg.type === 'send') {
      const pendingProfileId = pendingLlmProfileSwitchRef.current;
      if (pendingProfileId !== null) {
        queuedSendAfterLlmProfileSwitchRef.current.push(msg);
        const switchLabel = pendingProfileId ? `Switching LLM profile to '${pendingProfileId}'…` : 'Clearing LLM profile…';
        showStatusMessage('info', `${switchLabel} sending message when ready.`);
        return;
      }
    }

    const api = getVscodeApi();
    api.postMessage(msg);
  }, [showStatusMessage]);

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

  const {
    showSkillsPopover,
    setShowSkillsPopover,
    skills,
    setSkills,
    showToolsPopover,
    setShowToolsPopover,
    tools,
    setTools,
    enabledToolIds,
    setEnabledToolIds,
    handleOpenSkills: openSkillsPopover,
    handleOpenSkill,
    handleOpenTools: openToolsPopover,
    handleToggleTool,
  } = useSkillsAndTools({
    events,
    mode,
    postMessage,
    showStatusMessage,
  });

  const {
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
  } = useContextSelection({
    input,
    setInput,
    postMessage,
    setShowSkillsPopover,
    setShowToolsPopover,
  });

  const handleOpenSkills = useCallback(() => {
    setShowContextPicker(false);
    openSkillsPopover();
  }, [openSkillsPopover, setShowContextPicker]);

  const handleOpenTools = useCallback(() => {
    setShowContextPicker(false);
    openToolsPopover();
  }, [openToolsPopover, setShowContextPicker]);

  // Keep a snapshot for E2E state queries without re-registering message listeners on every keystroke.
  useEffect(() => {
    const welcome = getWelcomePromptFlags(welcomeSecretStatus);
    uiStateRef.current = {
      input,
      showContextPicker,
      showSkillsPopover,
      showHistory,
      showLlmProfiles,
      llmProfileId,
      llmProfiles: llmProfiles.slice(),
      workspaceFilesCount: workspaceFiles.length,
      selectedContextFiles: selectedContextFiles.slice(),
      skillsCount: skills.length,
      attachmentsCount: attachments.length,
      hasWelcomeProviderKey: welcome.hasProviderKey,
      hasWelcomeGeminiKey: welcome.hasGeminiKey,
      showWelcomeProviderKeyMessage: welcome.showProviderKeyMessage,
      showWelcomeGeminiKeyMessage: welcome.showGeminiKeyMessage,
    };
  }, [attachments.length, input, llmProfileId, llmProfiles, selectedContextFiles, showContextPicker, showHistory, showLlmProfiles, showSkillsPopover, skills.length, welcomeSecretStatus, workspaceFiles.length]);

  // If a message is sent immediately after switching profiles, the host might not have
  // applied the new settings yet. Queue the send until llmProfilesUpdated confirms.
  useEffect(() => {
    const pending = pendingLlmProfileSwitchRef.current;
    if (pending === null) return;
    if ((llmProfileId ?? '') !== pending) return;

    pendingLlmProfileSwitchRef.current = null;
    if (llmProfileSwitchTimeoutRef.current) {
      clearTimeout(llmProfileSwitchTimeoutRef.current);
      llmProfileSwitchTimeoutRef.current = null;
    }

    const queued = queuedSendAfterLlmProfileSwitchRef.current.splice(0);
    if (queued.length > 0) {
      for (const queuedMessage of queued) {
        postMessage(queuedMessage);
      }
    }
  }, [llmProfileId, llmProfiles, postMessage]);


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
    setQueuedMessagesCount,
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
    setQueuedMessagesCount,
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
    setWelcomeSecretStatus,
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

  // Handler functions
  const handleStartNewConversation = useCallback(() => {
    setStatusBanner({ message: 'Starting new conversation…', level: 'info' });
    setConversationId(undefined);
    setEvents([]);
    setPendingActions([]);
    setAgentStatus(undefined);
    setQueuedMessagesCount(0);
    setStreamingContent(null);
    setConversationTotals(INITIAL_CONVERSATION_TOTALS);
    hasLlmUsageRef.current = false;
    eventId.current = 1;
    setInput('');
    resetContextSelection();
    setAttachments([]);
    setInlineImages([]);
    setShowToolsPopover(false);
    postMessage({ type: 'command', command: 'startNewConversation' });
  }, [postMessage, resetContextSelection, setInlineImages, setShowToolsPopover, setStatusBanner]);

  const openMainPanel = useCallback((panel: 'history' | 'llmProfiles' | null) => {
    setShowHistory(panel === 'history');
    setShowLlmProfiles(panel === 'llmProfiles');
    setShowContextPicker(false);
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
  }, [setShowContextPicker, setShowHistory, setShowLlmProfiles, setShowSkillsPopover, setShowToolsPopover]);

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

    if (agentStatus === 'RUNNING') {
      setQueuedMessagesCount((prev) => prev + 1);
    }

    setInput('');
    resetContextSelection();
    setShowSkillsPopover(false);
    setShowToolsPopover(false);
    setAttachments([]);
    setInlineImages([]);

    const message: Extract<WebviewToHostMessage, { type: 'send' }> = {
      type: 'send',
      text: finalText,
      contextFiles: selectedContextFiles.slice(),
      attachments: attachments.map((a) => a.uri),
    };

    postMessage(message);
  }, [
    agentStatus,
    attachments,
    inlineImages,
    input,
    postMessage,
    resetContextSelection,
    selectedContextFiles,
    setInlineImages,
    setShowSkillsPopover,
    setShowToolsPopover,
  ]);

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

  const handleLoginToServer = useCallback(() => {
    postMessage({ type: 'command', command: 'cloudAuthLogin' });
    showStatusMessage('info', 'Starting login…');
  }, [postMessage, showStatusMessage]);

  const handleLogoutFromServer = useCallback(() => {
    postMessage({ type: 'command', command: 'cloudAuthLogout' });
    showStatusMessage('info', 'Logging out…');
  }, [postMessage, showStatusMessage]);

  const handleSelectLlmProfileId = useCallback((profileId: string) => {
    const next = profileId.trim();
    if (next === (llmProfileId ?? '')) {
      return;
    }

    // Do not optimistically update llmProfileId; wait for host confirmation via llmProfilesUpdated.
    postMessage({ type: 'setLlmProfileId', profileId: next });
  }, [llmProfileId, postMessage]);

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
        onLoginToServer={handleLoginToServer}
        onLogoutFromServer={handleLogoutFromServer}
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
          welcomeSecretStatus={welcomeSecretStatus}
          onOpenSecretsSettings={() => postMessage({ type: 'openSettingsSecrets' })}
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
            contextPickerAutoFocusSearch: !isMentionActive,
            onOpenSkills: handleOpenSkills,
            skillsCount: skills.length,
            showSkillsPopover,
            skillsPopoverSkills: skills,
            onOpenSkill: handleOpenSkill,
            onCloseSkillsPopover: () => setShowSkillsPopover(false),
            onOpenTools: handleOpenTools,
            toolsCount: mode === 'local' ? enabledToolIds.length : tools.length,
            showToolsPopover,
            toolsPopoverTools: tools,
            enabledToolIds,
            onToggleTool: handleToggleTool,
            toolsReadOnly: mode !== 'local',
            onCloseToolsPopover: () => setShowToolsPopover(false),
            onOpenAttachments: handleOpenAttachments,
            attachments,
            onOpenAttachment: handleOpenAttachment,
            onRemoveAttachment: handleRemoveAttachment,
            inlineImages,
            onPasteImageFiles: (files) => { void handlePasteImageFiles(files); },
            onRemoveInlineImage: handleRemoveInlineImage,
            onSelectionChange: handleSelectionChange,
            queuedMessagesCount,
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
