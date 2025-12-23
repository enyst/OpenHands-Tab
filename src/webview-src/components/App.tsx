import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isEvent,
  isSystemPromptEvent,
  isActionEvent,
  isObservationEvent,
  isUserRejectObservation,
  isMessageEvent,
  isAgentErrorEvent,
  isConversationErrorEvent,
  isPauseEvent,
  isCondensation,
  isConversationStateUpdateEvent,
  type Event,
  type ActionEvent,
} from '@openhands/agent-sdk-ts';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../shared/llmStreaming';
import { getHalDialogueLinesForMode, normalizeHalUserName, type HalScriptLine, type HalVoice } from '../../shared/halScript';
import { getVscodeApi } from '../shared/vscodeApi';

// Component imports
import { Header } from './Header';
import { InputArea, ContextPicker, SkillsPopover } from './InputArea';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { StatusBanner } from './StatusBanner';
import { HistoryView } from './HistoryView';
import { isElevenLabsMode, isHalDecision, type ElevenLabsMode, type HalDecision, type HalEye, type HalPhase, type HalStateSnapshot } from '../../shared/halTypes';
import { HalOverlay } from './HalOverlay';
import {
  SystemPromptEventBlock,
  ActionEventBlock,
  ObservationEventBlock,
  UserRejectBlock,
  AgentErrorBlock,
  ConversationErrorBlock,
  CondensationBlock,
  MessageEventBlock,
  StreamingMessageBlock,
} from './EventBlock';
import type { WebviewToHostMessage } from '../../shared/webviewMessages';

type RenderedEvent = { id: number; event: Event };

const isRenderableEvent = (event: Event) => !isConversationStateUpdateEvent(event);

type WebviewPersistedState = {
  conversationId?: string;
  lastSeenSeq?: number;
};

type ConversationsList = Array<{
  id: string;
  title?: string;
  firstMessage?: string;
  timestamp: number;
  messageCount?: number;
}>;

type StatusBannerState = {
  message: string;
  level: 'info' | 'warn' | 'error';
  dismissible?: boolean;
};

type InlineImageAttachment = {
  id: string;
  label: string;
  dataUrl: string;
  sizeBytes: number;
};

type ElevenLabsSettingsSnapshot = {
  enabled: boolean;
  mode: ElevenLabsMode;
  userName: string;
  volume: number;
};

const DEFAULT_ELEVENLABS_SETTINGS: ElevenLabsSettingsSnapshot = { enabled: false, mode: 'tts_only', userName: 'Engel', volume: 1 };
const DEFAULT_HAL_STATE: HalStateSnapshot = {
  enabled: false,
  mode: DEFAULT_ELEVENLABS_SETTINGS.mode,
  phase: 'idle',
  eye: 'off',
  stepIndex: null,
  decision: null,
  lastError: null,
};

type HalUiState = Pick<HalStateSnapshot, 'phase' | 'eye' | 'stepIndex' | 'decision' | 'lastError'>;

const DEFAULT_HAL_UI_STATE: HalUiState = {
  phase: 'idle',
  eye: 'off',
  stepIndex: null,
  decision: null,
  lastError: null,
};

const DEFAULT_BUNDLED_DIALOGUE_DELAY_MS = 650;
const DEFAULT_BUNDLED_AUDIO_EXTENSION = 'wav';

const MAX_PASTED_IMAGE_BYTES = 350 * 1024;
const MAX_PASTED_IMAGES = 4;

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read image.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      const error = reader.error ?? new Error('Failed to read image.');
      reject(error);
    };
    reader.readAsDataURL(blob);
  });
}

function escapeMarkdownAltText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/[\r\n]+/g, ' ').trim();
}

function mimeTypeToExtension(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? '';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype) return subtype;
  return 'png';
}

function normalizePastedImageLabel(file: File): string {
  const name = typeof file.name === 'string' ? file.name.trim() : '';
  if (name) return name.replace(/[\r\n]+/g, ' ').trim();
  const ext = mimeTypeToExtension(file.type);
  return `pasted-image.${ext}`;
}

function getOpenHandsMediaBaseUri(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="openhands-media-base"]');
  if (!meta) return null;
  const content = (meta as HTMLMetaElement).content?.trim() ?? '';
  return content || null;
}

function buildMediaUrl(relativePath: string): string | null {
  const base = getOpenHandsMediaBaseUri();
  if (!base) return null;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const rel = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}${rel}`;
}

function getBundledHalClipUrl(voice: HalVoice, stepIndex: number): string | null {
  return buildMediaUrl(`hal/bundled/${voice}/${stepIndex}.${DEFAULT_BUNDLED_AUDIO_EXTENSION}`);
}

function getBundledHalMusicStingUrl(): string | null {
  return buildMediaUrl(`hal/bundled/music_sting.${DEFAULT_BUNDLED_AUDIO_EXTENSION}`);
}

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 */
function EventBlock({ event, index }: { event: Event; index: number }) {
  if (isSystemPromptEvent(event)) return <SystemPromptEventBlock event={event} index={index} />;
  if (isActionEvent(event)) return <ActionEventBlock event={event} index={index} />;
  if (isObservationEvent(event)) return <ObservationEventBlock event={event} index={index} />;
  if (isUserRejectObservation(event)) return <UserRejectBlock event={event} index={index} />;
  if (isMessageEvent(event)) {
    const message = event.llm_message;
    if (message?.role === 'tool') return null;
    const hasRenderableContent = Array.isArray(message?.content)
      ? message.content.some((item) => {
        if (item.type === 'text') return item.text.trim().length > 0;
        return true;
      })
      : false;
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    if (message?.role === 'assistant' && hasToolCalls && !hasRenderableContent) {
      return null;
    }
    return <MessageEventBlock event={event} index={index} />;
  }
  if (isAgentErrorEvent(event)) return <AgentErrorBlock event={event} index={index} />;
  if (isConversationErrorEvent(event)) return <ConversationErrorBlock event={event} index={index} />;
  if (isPauseEvent(event)) return null; // Pause events only show in status bar
  if (isCondensation(event)) return <CondensationBlock event={event} index={index} />;

  // Fallback for unknown events
  const safeKind = 'kind' in event && typeof event.kind === 'string' ? event.kind : 'unknown';
  return (
    <div className="bg-white/5 border-l-[3px] border-gray-500 p-4 rounded-lg my-3">
      <div className="font-semibold mb-2">Unknown Event: {String(safeKind)}</div>
      <pre className="font-mono text-xs overflow-auto bg-black/20 p-3 rounded">
        {JSON.stringify(event ?? {}, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Status message debouncing configuration
 */
const STATUS_DEBOUNCE_MS = 600;
let lastStatusMessage = { level: '' as 'info' | 'warn' | 'error', message: '', at: 0 };

/**
 * Main App component: React webview root for OpenHands extension.
 */
export function App() {
  // Connection state
  const [status, setStatus] = useState<'online' | 'offline' | 'connecting'>('offline');
  const [mode, setMode] = useState<'local' | 'remote'>('remote');
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [llmProfileLabel, setLlmProfileLabel] = useState<string | null | undefined>(undefined);
  const [llmProfileId, setLlmProfileId] = useState<string | null>(null);
  const [llmProfiles, setLlmProfiles] = useState<string[]>([]);

  // Events and conversation state
  const [events, setEvents] = useState<RenderedEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [pendingActions, setPendingActions] = useState<ActionEvent[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const eventId = useRef(1);

  // Input state
  const [input, setInput] = useState('');
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Attachments state
  const [attachments, setAttachments] = useState<Array<{ uri: string; label: string; sizeBytes?: number }>>([]);
  const [inlineImages, setInlineImages] = useState<InlineImageAttachment[]>([]);

  // UI state
  const [statusBanner, setStatusBanner] = useState<StatusBannerState | null>(
    { message: 'Initializing…', level: 'info' }
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Context picker state
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [selectedContextFiles, setSelectedContextFiles] = useState<string[]>([]);
  const [isMentionActive, setIsMentionActive] = useState(false);
  const mentionStartRef = useRef<number | null>(null);

  // Skills state
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<{ label: string; path: string }[]>([]);

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number }>>([]);

  // Server selection state
  const [servers, setServers] = useState<{ url: string; label?: string }[]>([]);
  const [currentServerUrl, setCurrentServerUrl] = useState<string | undefined>(undefined);

  // HAL / ElevenLabs settings + state (Phase 0: bundled mode only)
  const [elevenlabs, setElevenlabs] = useState<ElevenLabsSettingsSnapshot>(DEFAULT_ELEVENLABS_SETTINGS);
  const [halDisabledConversationId, setHalDisabledConversationId] = useState<string | null>(null);
  const [halPhase, setHalPhase] = useState<HalPhase>('idle');
  const [halEye, setHalEye] = useState<HalEye>('off');
  const [halStepIndex, setHalStepIndex] = useState<number | null>(null);
  const [halDecision, setHalDecision] = useState<HalDecision | null>(null);
  const [halLastError, setHalLastError] = useState<string | null>(null);
  const [halForceRejectInput, setHalForceRejectInput] = useState(false);
  const [halTeleporting, setHalTeleporting] = useState(false);
  const [halVoiceConfirmFallbackKey, setHalVoiceConfirmFallbackKey] = useState<string | null>(null);
  const halTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const halStepIndexRef = useRef<number | null>(null);
  const halDialogueRef = useRef<HalScriptLine[]>([]);
  const halTtsRequestIdRef = useRef<string | null>(null);
  const halTtsRequestedKeyRef = useRef<string | null>(null);
  const halAudioRef = useRef<HTMLAudioElement | null>(null);
  const halAudioUrlRef = useRef<string | null>(null);
  const halAudioPlayTokenRef = useRef(0);
  const halBundledAudioKeyRef = useRef<string | null>(null);
  const halBundledMusicKeyRef = useRef<string | null>(null);
  const halTtsRequestSeqRef = useRef(0);
  const halVoiceConfirmFallbackKeyRef = useRef<string | null>(null);
  const halVoiceConfirmRequestIdRef = useRef<string | null>(null);
  const halVoiceConfirmSeqRef = useRef(0);
  const halVoiceDiscardNextStopRef = useRef(false);
  const halVoiceStreamRef = useRef<MediaStream | null>(null);
  const halVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const halVoiceChunksRef = useRef<Blob[]>([]);
  const halActiveKeyRef = useRef<string | null>(null);
  const [halSuppressedKey, setHalSuppressedKey] = useState<string | null>(null);
  const halStateRef = useRef<HalStateSnapshot>(DEFAULT_HAL_STATE);
  const halEnabledRef = useRef<boolean>(false);
  const halPhaseRef = useRef<HalPhase>('idle');
  const halSuppressedKeyRef = useRef<string | null>(null);
  const halTeleportInProgressRef = useRef(false);
  const pendingActionsRef = useRef<ActionEvent[]>([]);
  const agentStatusRef = useRef<string | undefined>(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const currentServerUrlRef = useRef<string | undefined>(undefined);
  const elevenlabsRef = useRef<ElevenLabsSettingsSnapshot>(DEFAULT_ELEVENLABS_SETTINGS);

  // Refs
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastAgentStatusRef = useRef<string | undefined>(undefined);
  const streamingStateRef = useRef(initialLlmStreamingState);
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const halSupportedMode = elevenlabs.mode === 'bundled' || elevenlabs.mode === 'tts_only' || elevenlabs.mode === 'voice_confirm';
  const halEnabled = elevenlabs.enabled && halSupportedMode && halDisabledConversationId !== conversationId;

  useEffect(() => {
    halEnabledRef.current = halEnabled;
  }, [halEnabled]);

  useEffect(() => {
    halPhaseRef.current = halPhase;
  }, [halPhase]);

  useEffect(() => {
    halSuppressedKeyRef.current = halSuppressedKey;
  }, [halSuppressedKey]);

  useEffect(() => {
    halVoiceConfirmFallbackKeyRef.current = halVoiceConfirmFallbackKey;
  }, [halVoiceConfirmFallbackKey]);

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

  useEffect(() => {
    elevenlabsRef.current = elevenlabs;
  }, [elevenlabs]);

  useEffect(() => {
    halStepIndexRef.current = halStepIndex;
  }, [halStepIndex]);

  const stopHalAudio = useCallback(() => {
    halAudioPlayTokenRef.current += 1;
    const audio = halAudioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {}
      audio.src = '';
    }
    if (halAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(halAudioUrlRef.current);
      } catch {}
      halAudioUrlRef.current = null;
    }
    halTtsRequestIdRef.current = null;
    halTtsRequestedKeyRef.current = null;
  }, []);

  const cleanupHalVoiceConfirm = useCallback(() => {
    const recorder = halVoiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        halVoiceDiscardNextStopRef.current = true;
        recorder.stop();
      } catch {}
    }
    halVoiceRecorderRef.current = null;
    halVoiceChunksRef.current = [];
    const stream = halVoiceStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    }
    halVoiceStreamRef.current = null;
    halVoiceConfirmRequestIdRef.current = null;
  }, []);

    const blobToBase64 = (blob: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result !== 'string') {
            reject(new Error('Failed to read recorded audio.'));
            return;
          }
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => {
          const error = reader.error ?? new Error('Failed to read recorded audio.');
          reject(error);
        };
        reader.readAsDataURL(blob);
      });

  useEffect(() => {
    halStateRef.current = {
      enabled: halEnabled,
      mode: elevenlabs.mode,
      phase: halPhase,
      eye: halEye,
      stepIndex: halPhase === 'dialogue' ? halStepIndex : null,
      decision: halDecision,
      lastError: halLastError,
    };
  }, [elevenlabs.mode, halDecision, halEnabled, halEye, halLastError, halPhase, halStepIndex]);

  // Show status message with debouncing
  const showStatusMessage = useCallback((level: 'info' | 'warn' | 'error', message: string) => {
    const now = Date.now();
    if (lastStatusMessage.level === level && lastStatusMessage.message === message && now - lastStatusMessage.at < STATUS_DEBOUNCE_MS) {
      return;
    }
    lastStatusMessage = { level, message, at: now };
    setStatusBanner({ message, level });
  }, []);

  const handlePasteImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const nextImages: InlineImageAttachment[] = [];
    let didSkipLarge = false;
    let didSkipSvg = false;
    const remainingSlots = Math.max(0, MAX_PASTED_IMAGES - inlineImages.length);
    if (remainingSlots === 0) {
      showStatusMessage('warn', `You can paste up to ${MAX_PASTED_IMAGES} images per message.`);
      return;
    }

    for (const file of files) {
      if (nextImages.length >= remainingSlots) break;
      if (!file.type.startsWith('image/')) continue;
      if (file.type === 'image/svg+xml') {
        didSkipSvg = true;
        continue;
      }
      if (file.size > MAX_PASTED_IMAGE_BYTES) {
        didSkipLarge = true;
        continue;
      }

      try {
        const dataUrl = await readBlobAsDataUrl(file);
        nextImages.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          label: normalizePastedImageLabel(file),
          dataUrl,
          sizeBytes: file.size,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        showStatusMessage('error', `Failed to paste image: ${reason}`);
      }
    }

    if (didSkipLarge) {
      showStatusMessage('warn', `Some images were too large to paste (max ${Math.trunc(MAX_PASTED_IMAGE_BYTES / 1024)}KB).`);
    }
    if (didSkipSvg) {
      showStatusMessage('warn', 'SVG images are not supported for pasted images.');
    }

    if (nextImages.length === 0) return;
    setInlineImages((prev) => [...prev, ...nextImages].slice(0, MAX_PASTED_IMAGES));
  }, [inlineImages.length, showStatusMessage]);

  const handleRemoveInlineImage = useCallback((id: string) => {
    setInlineImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleConversationStateUpdate = useCallback((event: Event) => {
    if (!isConversationStateUpdateEvent(event)) return false;

    if (event.agent_status) {
      agentStatusRef.current = event.agent_status;
      setAgentStatus(event.agent_status);
      if (event.agent_status === 'WAITING_FOR_CONFIRMATION' && lastAgentStatusRef.current !== 'WAITING_FOR_CONFIRMATION') {
        showStatusMessage('warn', 'Agent is waiting for confirmation');
      }
      lastAgentStatusRef.current = event.agent_status;
    }

    return true;
  }, [showStatusMessage]);

  const handleStreamingUpdate = useCallback((event: Event) => {
    const streamingUpdate = reduceLlmStreamingState(streamingStateRef.current, event);
    streamingStateRef.current = streamingUpdate.state;

    if (streamingUpdate.started || streamingUpdate.completed || streamingUpdate.contentUpdated) {
      setStreamingContent(streamingUpdate.state.content);
    }
  }, []);

  const handlePendingActions = useCallback((event: Event) => {
    const clearSubmissionState = () => {
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current);
        submissionTimeoutRef.current = null;
      }
      setIsSubmitting(false);
    };

    if (isActionEvent(event)) {
      const prev = pendingActionsRef.current;
      const exists = prev.some((a) => a.tool_call_id === event.tool_call_id);
      if (!exists) {
        const next = [...prev, event];
        pendingActionsRef.current = next;
        setPendingActions(next);
      }
    } else if (isObservationEvent(event) || isUserRejectObservation(event)) {
      const prev = pendingActionsRef.current;
      const next = prev.filter((a) => a.tool_call_id !== event.tool_call_id);
      if (next.length !== prev.length) {
        pendingActionsRef.current = next;
        setPendingActions(next);
      }
      clearSubmissionState();
    } else if (isAgentErrorEvent(event)) {
      showStatusMessage('error', event.error);
      clearSubmissionState();
    } else if (isPauseEvent(event)) {
      showStatusMessage('warn', 'Conversation paused');
    }
  }, [showStatusMessage]);

  const clearHalTimer = useCallback(() => {
    if (halTimerRef.current) {
      clearTimeout(halTimerRef.current);
      halTimerRef.current = null;
    }
  }, []);

  const setHalSuppressedKeySynced = useCallback((next: string | null) => {
    halSuppressedKeyRef.current = next;
    setHalSuppressedKey(next);
  }, []);

  const resetHalUiState = useCallback((overrides: Partial<HalUiState> = {}) => {
    const next: HalUiState = { ...DEFAULT_HAL_UI_STATE, ...overrides };
    halPhaseRef.current = next.phase;
    setHalPhase(next.phase);
    setHalEye(next.eye);
    setHalStepIndex(next.stepIndex);
    setHalDecision(next.decision);
    setHalLastError(next.lastError);
  }, []);

  const cleanupHalFlow = useCallback(() => {
    clearHalTimer();
    stopHalAudio();
    cleanupHalVoiceConfirm();
  }, [clearHalTimer, cleanupHalVoiceConfirm, stopHalAudio]);

  const halDialogueLines = useMemo(
    () => getHalDialogueLinesForMode(elevenlabs.userName, elevenlabs.mode),
    [elevenlabs.mode, elevenlabs.userName]
  );

  useEffect(() => {
    halDialogueRef.current = halDialogueLines;
  }, [halDialogueLines]);

  const getHalConversationKey = useCallback(() => conversationIdRef.current ?? 'unknown', []);

  const maybeUpdateHalFlow = useCallback(() => {
    if (halTeleportInProgressRef.current) return;
    const enabled = halEnabledRef.current;
    const convoId = conversationIdRef.current;
    const isDisabledForConversation = Boolean(convoId) && halDisabledConversationId === convoId;
    const status = agentStatusRef.current;
    const pending = pendingActionsRef.current;
    const firstHighRisk = pending.find((action) => action.security_risk === 'HIGH');
    const nextKey =
      enabled && !isDisabledForConversation && status === 'WAITING_FOR_CONFIRMATION' && firstHighRisk?.tool_call_id
        ? `${convoId ?? 'unknown'}:${firstHighRisk.tool_call_id}`
        : null;

    if (!nextKey) {
      if (halActiveKeyRef.current !== null || halPhaseRef.current !== 'idle' || halSuppressedKeyRef.current !== null) {
        cleanupHalFlow();
        halActiveKeyRef.current = null;
        setHalSuppressedKeySynced(null);
        resetHalUiState();
        setHalForceRejectInput(false);
        setHalTeleporting(false);
      }
      return;
    }

    const isNewSession = halActiveKeyRef.current !== nextKey;
    if (isNewSession) {
      halActiveKeyRef.current = nextKey;
      setHalSuppressedKeySynced(null);
      setHalForceRejectInput(false);
    }

    if (halSuppressedKeyRef.current === nextKey) {
      if (halPhaseRef.current !== 'idle') {
        cleanupHalFlow();
        resetHalUiState();
      }
      return;
    }

    if (halPhaseRef.current === 'idle') {
      clearHalTimer();
      stopHalAudio();
      resetHalUiState({ phase: 'dialogue', eye: 'pulsating', stepIndex: 0 });
    }
  }, [clearHalTimer, cleanupHalFlow, halDisabledConversationId, resetHalUiState, setHalSuppressedKeySynced, stopHalAudio]);

  const handleHalAudioFinished = useCallback(() => {
    if (halPhaseRef.current !== 'dialogue') return;
    const currentIndex = halStepIndexRef.current;
    if (currentIndex === null) return;
    const lastIndex = halDialogueRef.current.length - 1;
    if (currentIndex >= lastIndex) {
      setHalPhase('awaiting_user');
      setHalStepIndex(null);
      return;
    }
    setHalStepIndex(currentIndex + 1);
  }, []);

  const advanceBundledDialogueAfterDelay = useCallback(
    (currentIndex: number) => {
      clearHalTimer();
      halTimerRef.current = setTimeout(() => {
        const lastIndex = halDialogueRef.current.length - 1;
        if (currentIndex >= lastIndex) {
          setHalPhase('awaiting_user');
          setHalStepIndex(null);
          return;
        }
        setHalStepIndex(currentIndex + 1);
      }, DEFAULT_BUNDLED_DIALOGUE_DELAY_MS);
    },
    [clearHalTimer]
  );

  useEffect(() => {
    if (halPhase !== 'dialogue') return;
    if (halStepIndex === null) return;
    if (elevenlabsRef.current.mode !== 'bundled') return;

    const sessionKey = halActiveKeyRef.current ?? 'unknown';
    const playKey = `${sessionKey}:${halStepIndex}`;
    if (halBundledAudioKeyRef.current === playKey) return;
    halBundledAudioKeyRef.current = playKey;

    clearHalTimer();

    const line = halDialogueLines[halStepIndex];
    const clipUrl = line ? getBundledHalClipUrl(line.voice, halStepIndex) : null;
    if (!clipUrl || typeof Audio !== 'function') {
      advanceBundledDialogueAfterDelay(halStepIndex);
      return;
    }

    const volume = elevenlabsRef.current.volume;
    stopHalAudio();
    const token = halAudioPlayTokenRef.current;
    const audio = new Audio(clipUrl);
    halAudioRef.current = audio;
    audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    audio.onended = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      handleHalAudioFinished();
    };
    const fallBackToTimer = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      const currentIndex = halStepIndexRef.current;
      advanceBundledDialogueAfterDelay(currentIndex ?? halStepIndex);
    };
    audio.onerror = fallBackToTimer;
    void audio.play().catch(fallBackToTimer);

    return () => {
      clearHalTimer();
      stopHalAudio();
    };
  }, [
    advanceBundledDialogueAfterDelay,
    clearHalTimer,
    halDialogueLines,
    halPhase,
    halStepIndex,
    handleHalAudioFinished,
    stopHalAudio,
  ]);

  useEffect(() => {
    if (halPhase !== 'waiting_remote') {
      halBundledMusicKeyRef.current = null;
      return;
    }

    const sessionKey = halActiveKeyRef.current ?? 'unknown';
    if (halBundledMusicKeyRef.current === sessionKey) return;
    halBundledMusicKeyRef.current = sessionKey;

    const url = getBundledHalMusicStingUrl();
    if (!url || typeof Audio !== 'function') return;

    const volume = elevenlabsRef.current.volume;
    stopHalAudio();
    const token = halAudioPlayTokenRef.current;
    const audio = new Audio(url);
    halAudioRef.current = audio;
    audio.loop = true;
    audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    audio.onerror = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
    };
    void audio.play().catch(() => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
    });

    return () => {
      stopHalAudio();
    };
  }, [halPhase, stopHalAudio]);

  const playHalAudioBytes = useCallback((bytes: Uint8Array, volume: number) => {
    stopHalAudio();
    const token = halAudioPlayTokenRef.current;
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    halAudioUrlRef.current = url;

    const audio = new Audio(url);
    halAudioRef.current = audio;
    audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    audio.onended = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      handleHalAudioFinished();
    };
    audio.onerror = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      handleHalAudioFinished();
    };
    void audio.play().catch(() => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      handleHalAudioFinished();
    });
  }, [handleHalAudioFinished, stopHalAudio]);

  const requestHalTts = useCallback((params: { conversationId: string; stepIndex: number }) => {
    const requestId = `halTts:${Date.now().toString(36)}:${(halTtsRequestSeqRef.current++).toString(36)}`;
    halTtsRequestIdRef.current = requestId;
    postMessage({
      type: 'halTtsRequest',
      requestId,
      conversationId: params.conversationId,
      stepIndex: params.stepIndex,
    });
  }, [postMessage]);

  useEffect(() => {
    if (halPhase !== 'dialogue') return;
    if (halStepIndex === null) return;
    const mode = elevenlabsRef.current.mode;
    if (mode !== 'tts_only' && mode !== 'voice_confirm') return;
    const convoId = conversationIdRef.current;
    if (!convoId) return;
    if (halDisabledConversationId === convoId) return;
    const key = `${convoId}:${halStepIndex}:${mode}`;
    if (halTtsRequestedKeyRef.current === key) return;
    halTtsRequestedKeyRef.current = key;
    requestHalTts({ conversationId: convoId, stepIndex: halStepIndex });
  }, [halDisabledConversationId, halPhase, halStepIndex, requestHalTts]);

  const disableVoiceConfirmForConversation = useCallback((message: string) => {
    const key = getHalConversationKey();
    setHalVoiceConfirmFallbackKey(key);
    halVoiceConfirmFallbackKeyRef.current = key;
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', lastError: message });
    showStatusMessage('warn', message);
  }, [cleanupHalVoiceConfirm, getHalConversationKey, resetHalUiState, showStatusMessage]);

  const handleStartVoiceConfirm = useCallback(() => {
    void (async () => {
      if (halPhaseRef.current !== 'awaiting_user') return;
      if (elevenlabsRef.current.mode !== 'voice_confirm') return;
      if (halVoiceConfirmFallbackKeyRef.current === getHalConversationKey()) return;
      if (
        typeof navigator === 'undefined' ||
        typeof navigator.mediaDevices?.getUserMedia !== 'function' ||
        typeof MediaRecorder === 'undefined'
      ) {
        disableVoiceConfirmForConversation('Microphone is unavailable in this environment. Using buttons instead.');
        return;
      }

      const conversationKey = getHalConversationKey();
      const sessionKey = halActiveKeyRef.current;

      cleanupHalVoiceConfirm();
      halVoiceDiscardNextStopRef.current = false;
      halVoiceChunksRef.current = [];
      setHalLastError(null);
      halPhaseRef.current = 'listening';
      setHalPhase('listening');
      setHalEye('pulsating');

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        disableVoiceConfirmForConversation(`Microphone permission denied or unavailable: ${reason}`);
        return;
      }

      if (halPhaseRef.current !== 'listening' || getHalConversationKey() !== conversationKey || halActiveKeyRef.current !== sessionKey) {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {}
        }
        return;
      }

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((t) => {
        try {
          return MediaRecorder.isTypeSupported(t);
        } catch {
          return false;
        }
      });
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {}
        }
        disableVoiceConfirmForConversation(`Microphone recording is not supported: ${reason}`);
        return;
      }

      halVoiceStreamRef.current = stream;
      halVoiceRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          halVoiceChunksRef.current.push(e.data);
        }
      };
      recorder.onstop = () => {
        void (async () => {
          const shouldDiscard = halVoiceDiscardNextStopRef.current;
          halVoiceDiscardNextStopRef.current = false;

          const chunks = halVoiceChunksRef.current;
          halVoiceChunksRef.current = [];
          halVoiceRecorderRef.current = null;
          const activeStream = halVoiceStreamRef.current;
          halVoiceStreamRef.current = null;
          if (activeStream) {
            for (const track of activeStream.getTracks()) {
              try {
                track.stop();
              } catch {}
            }
          }

          if (shouldDiscard) return;
          if (chunks.length === 0) {
            disableVoiceConfirmForConversation('No audio was captured. Using buttons instead.');
            return;
          }

          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
            if (blob.size === 0) {
              disableVoiceConfirmForConversation('No audio was captured. Using buttons instead.');
              return;
            }
            const audioBase64 = await blobToBase64(blob);
            if (!audioBase64) {
              disableVoiceConfirmForConversation('No audio was captured. Using buttons instead.');
              return;
            }
            const requestId = `halVoiceConfirm:${Date.now().toString(36)}:${(halVoiceConfirmSeqRef.current++).toString(36)}`;
            halVoiceConfirmRequestIdRef.current = requestId;
            setHalLastError(null);
            halPhaseRef.current = 'classifying';
            setHalPhase('classifying');
            setHalEye('pulsating');
            postMessage({
              type: 'halVoiceConfirmRequest',
              requestId,
              mimeType: blob.type || 'audio/webm',
              audioBase64,
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            disableVoiceConfirmForConversation(`Failed to process recorded audio: ${reason}`);
          }
        })();
      };

      try {
        recorder.start();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {}
        }
        disableVoiceConfirmForConversation(`Failed to start recording: ${reason}`);
        return;
      }
    })();
  }, [cleanupHalVoiceConfirm, disableVoiceConfirmForConversation, getHalConversationKey, postMessage]);

  const handleStopVoiceConfirm = useCallback(() => {
    if (halPhaseRef.current !== 'listening') return;
    const recorder = halVoiceRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'inactive') return;
    try {
      recorder.stop();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      disableVoiceConfirmForConversation(`Failed to stop recording: ${reason}`);
    }
  }, [disableVoiceConfirmForConversation]);

  const handleCancelVoiceConfirm = useCallback(() => {
    if (halPhaseRef.current !== 'listening') return;
    halVoiceDiscardNextStopRef.current = true;
    const recorder = halVoiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {}
    }
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating' });
  }, [cleanupHalVoiceConfirm, resetHalUiState]);

  const handleUseButtonsInstead = useCallback(() => {
    const key = getHalConversationKey();
    setHalVoiceConfirmFallbackKey(key);
    halVoiceConfirmFallbackKeyRef.current = key;
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating' });
    showStatusMessage('info', 'Switched to button decision for this conversation.');
  }, [cleanupHalVoiceConfirm, getHalConversationKey, resetHalUiState, showStatusMessage]);

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

  const handleHalExit = useCallback(() => {
    cleanupHalFlow();
    halTeleportInProgressRef.current = false;
    setHalTeleporting(false);
    setHalForceRejectInput(false);
    const key = halActiveKeyRef.current;
    if (key) {
      setHalSuppressedKeySynced(key);
    }
    resetHalUiState();
  }, [cleanupHalFlow, resetHalUiState, setHalSuppressedKeySynced]);

  const handleHalApprove = useCallback(() => {
    setHalDecision('approve_local');
    handleApprove();
  }, [handleApprove]);

  const handleHalReject = useCallback((reason?: string) => {
    setHalDecision('reject');
    handleReject(reason);
  }, [handleReject]);

  const handleHalTeleport = useCallback(() => {
    cleanupHalFlow();
    halTeleportInProgressRef.current = true;
    setHalTeleporting(true);
    setHalForceRejectInput(false);
    resetHalUiState({ phase: 'waiting_remote', eye: 'pulsating', decision: 'teleport_remote' });
    showStatusMessage('info', 'Teleporting to remote runtime…');
    postMessage({ type: 'command', command: 'teleportAction' });
  }, [cleanupHalFlow, postMessage, resetHalUiState, showStatusMessage]);

  const handleRenderableEvent = useCallback((event: Event) => {
    if (!isRenderableEvent(event)) return;

    setEvents((ev) => [...ev, { id: eventId.current++, event }]);
  }, []);

  // Handle incoming events
  const handleEvent = useCallback((incomingEvent: unknown) => {
    if (!isEvent(incomingEvent)) return;

    const event = incomingEvent;
    handleStreamingUpdate(event);
    if (handleConversationStateUpdate(event)) {
      maybeUpdateHalFlow();
      return;
    }

    handlePendingActions(event);
    maybeUpdateHalFlow();
    handleRenderableEvent(event);
  }, [handleConversationStateUpdate, handlePendingActions, handleRenderableEvent, handleStreamingUpdate, maybeUpdateHalFlow]);

  // Signal webview is ready on mount
  useEffect(() => {
    const vscodeApi = getVscodeApi();
    let didRequestSkills = false;
    const sendReady = () => {
      const state = vscodeApi.getState?.<WebviewPersistedState>() ?? {};
      const payload: WebviewToHostMessage = { type: 'webviewReady' };
      if (typeof state.conversationId === 'string') payload.conversationId = state.conversationId;
      if (typeof state.lastSeenSeq === 'number') payload.lastSeenSeq = state.lastSeenSeq;
      postMessage(payload);
      if (!didRequestSkills) {
        didRequestSkills = true;
        postMessage({ type: 'requestSkills' });
      }
    };

    sendReady();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendReady();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [postMessage]);

  // Message handler: processes incoming messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        requestId?: string;
        status?: 'online' | 'offline' | 'connecting';
        serverUrl?: string | null;
        mode?: 'local' | 'remote';
        llmProfileLabel?: string | null;
        llmModel?: string | null;
        profiles?: string[];
        activeProfileId?: string | null;
        elevenlabs?: Partial<ElevenLabsSettingsSnapshot> & { [k: string]: unknown };
        event?: unknown;
        seq?: unknown;
        error?: unknown;
        conversationId?: string;
        files?: string[];
        skills?: { label: string; path: string }[];
        conversations?: ConversationsList;
        servers?: { url: string; label?: string }[];
        attachments?: Array<{ uri: string; label: string; sizeBytes?: number }>;
      };

      switch (payload?.type) {
        case 'status':
          if (payload.status) {
            setStatus(payload.status);
            if (payload.mode === 'local' || payload.mode === 'remote') {
              setMode(payload.mode);
            }
            const label = payload.llmProfileLabel !== undefined ? payload.llmProfileLabel : payload.llmModel;
            if (typeof label === 'string' || label === null) {
              setLlmProfileLabel(label);
            }
            if (payload.mode === 'local') {
              setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
            } else if (payload.status === 'connecting') {
              setStatusBanner({ message: 'Connecting to server…', level: 'info' });
            } else if (payload.status === 'online') {
              setStatusBanner({ message: 'Connected to server', level: 'info' });
            } else if (payload.status === 'offline') {
              setStatusBanner({ message: 'Disconnected from server', level: 'warn' });
            }
          }
          break;
        case 'llmProfilesUpdated': {
          if (Array.isArray(payload.profiles)) {
            setLlmProfiles(payload.profiles.filter((id): id is string => typeof id === 'string'));
          }
          if (typeof payload.activeProfileId === 'string' || payload.activeProfileId === null) {
            setLlmProfileId(payload.activeProfileId);
          }
          break;
        }
        case 'configUpdated':
          if (typeof payload.serverUrl === 'string' || payload.serverUrl === null) {
            const url = payload.serverUrl || undefined;
            setCurrentServerUrl(url);
            const label = url || 'local mode';
            showStatusMessage('info', `Config updated: ${label}`);
          }
          if (payload.mode === 'local') {
            setMode('local');
            setCurrentServerUrl(undefined);
            setStatusBanner({ message: 'Local mode: running without remote server', level: 'info', dismissible: false });
          } else if (payload.mode === 'remote') {
            setMode('remote');
          }
          break;
        case 'serverListUpdated': {
          if (Array.isArray(payload.servers)) {
            setServers(payload.servers);
          }
          if (typeof payload.serverUrl === 'string') {
            const nextUrl = payload.serverUrl || undefined;
            const prevUrl = currentServerUrlRef.current;
            currentServerUrlRef.current = nextUrl;
            setCurrentServerUrl(nextUrl);

              // If the server target changed (Local ↔ Remote or remote server URL changed),
              // start a fresh conversation UI instead of implicitly resuming prior state.
              if (prevUrl !== nextUrl) {
                setHalDisabledConversationId(null);
                setHalVoiceConfirmFallbackKey(null);
                cleanupHalVoiceConfirm();
                conversationIdRef.current = undefined;
                setConversationId(undefined);
                setEvents([]);
                pendingActionsRef.current = [];
              setPendingActions([]);
              agentStatusRef.current = undefined;
              setAgentStatus(undefined);
              setStreamingContent(null);
              eventId.current = 1;
              const api = getVscodeApi();
              api.setState?.({});
              maybeUpdateHalFlow();
            }
          }
          break;
        }
        case 'elevenlabsSettings':
          if (payload.elevenlabs && typeof payload.elevenlabs === 'object') {
            const prev = elevenlabsRef.current;
            const next: ElevenLabsSettingsSnapshot = { ...prev };
            if (typeof payload.elevenlabs?.enabled === 'boolean') next.enabled = payload.elevenlabs.enabled;
            if (isElevenLabsMode(payload.elevenlabs?.mode)) next.mode = payload.elevenlabs.mode;
            if (typeof payload.elevenlabs?.userName === 'string') next.userName = payload.elevenlabs.userName;
            if (typeof payload.elevenlabs?.volume === 'number' && Number.isFinite(payload.elevenlabs.volume)) {
              next.volume = Math.min(1, Math.max(0, payload.elevenlabs.volume));
            }

            elevenlabsRef.current = next;
            halEnabledRef.current = next.enabled && (next.mode === 'bundled' || next.mode === 'tts_only' || next.mode === 'voice_confirm');
            setElevenlabs(next);
            maybeUpdateHalFlow();
          }
          break;
        case 'halTtsResponse': {
          const currentRequestId = halTtsRequestIdRef.current;
          const requestId = (payload as { requestId?: unknown } | undefined)?.requestId;
          if (!currentRequestId || typeof requestId !== 'string' || requestId !== currentRequestId) break;
          halTtsRequestIdRef.current = null;

          const ok = (payload as { ok?: unknown } | undefined)?.ok;
          if (ok === true) {
            const base64 = (payload as { audioBase64?: unknown } | undefined)?.audioBase64;
            if (typeof base64 !== 'string' || base64.length === 0) {
              handleHalAudioFinished();
              break;
            }
            const volume = (payload as { volume?: unknown } | undefined)?.volume;
            try {
              const raw = atob(base64);
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i += 1) {
                bytes[i] = raw.charCodeAt(i);
              }
              playHalAudioBytes(bytes, typeof volume === 'number' ? volume : elevenlabsRef.current.volume);
            } catch {
              handleHalAudioFinished();
            }
            break;
          }

          const shouldNotify = (payload as { shouldNotify?: unknown } | undefined)?.shouldNotify === true;
          const error = (payload as { error?: unknown } | undefined)?.error;
          const message = typeof error === 'string' && error.trim() ? error.trim() : 'ElevenLabs TTS failed';
          const convoId = conversationIdRef.current;
          if (convoId) setHalDisabledConversationId(convoId);

          halTeleportInProgressRef.current = false;
          cleanupHalFlow();
          halActiveKeyRef.current = null;
          setHalSuppressedKeySynced(null);
          resetHalUiState();
          setHalForceRejectInput(false);
          setHalTeleporting(false);

          if (shouldNotify) showStatusMessage('error', `HAL audio disabled for this conversation: ${message}`);
          break;
        }
        case 'halVoiceConfirmResponse': {
          const currentRequestId = halVoiceConfirmRequestIdRef.current;
          const requestId = (payload as { requestId?: unknown } | undefined)?.requestId;
          if (!currentRequestId || typeof requestId !== 'string' || requestId !== currentRequestId) break;
          halVoiceConfirmRequestIdRef.current = null;

          const ok = (payload as { ok?: unknown } | undefined)?.ok;
          if (ok === true) {
            const decisionRaw = (payload as { decision?: unknown } | undefined)?.decision;
            if (!isHalDecision(decisionRaw)) {
              disableVoiceConfirmForConversation('Gemini returned an invalid decision. Using buttons instead.');
              break;
            }

            if (decisionRaw === 'teleport_remote') {
              handleHalTeleport();
              break;
            }

            resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', decision: decisionRaw });
            if (decisionRaw === 'approve_local') {
              handleApprove();
            } else {
              handleReject(undefined);
            }
            break;
          }

          const error = (payload as { error?: unknown } | undefined)?.error;
          const message = typeof error === 'string' && error.trim() ? error.trim() : 'Gemini classification failed';
          disableVoiceConfirmForConversation(message);
          break;
        }
          case 'attachmentsSelected':
            if (Array.isArray(payload.attachments)) {
              setAttachments((prev) => {
                const existing = new Set(prev.map((a) => a.uri));
              const next = [...prev];
              for (const a of payload.attachments ?? []) {
                if (!a || typeof a.uri !== 'string' || typeof a.label !== 'string') continue;
                if (existing.has(a.uri)) continue;
                next.push(a);
                existing.add(a.uri);
              }
              return next;
            });
          }
          break;
        case 'event':
          if (isEvent(payload.event)) {
            handleEvent(payload.event);
            if (typeof payload.seq === 'number') {
              const api = getVscodeApi();
              const prev = api.getState?.<WebviewPersistedState>() ?? {};
              api.setState?.({ ...prev, lastSeenSeq: payload.seq });
            }
          }
          break;
        case 'error':
          if (typeof payload.error === 'string') {
            setStatusBanner({ message: payload.error, level: 'error' });
          } else {
            setStatusBanner({ message: 'An unknown error occurred', level: 'error' });
          }
          break;
        case 'halTeleportUnavailable': {
          const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : 'No server available';
          halTeleportInProgressRef.current = false;
          setHalTeleporting(false);
          setHalForceRejectInput(true);
          resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', lastError: message });
          showStatusMessage('error', message);
          break;
        }
        case 'halTeleportFailed': {
          const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : 'Teleport failed';
          halTeleportInProgressRef.current = false;
          setHalTeleporting(false);
          setHalForceRejectInput(false);
          resetHalUiState({ phase: 'error', eye: 'dim', lastError: message });
          showStatusMessage('error', message);
          break;
        }
        case 'conversationStarted':
          if (typeof payload.conversationId === 'string') {
            setHalDisabledConversationId(null);
            setHalVoiceConfirmFallbackKey(null);
            cleanupHalVoiceConfirm();
            if (halTeleportInProgressRef.current || halPhaseRef.current === 'waiting_remote') {
              halTeleportInProgressRef.current = false;
              setHalTeleporting(false);
              setHalForceRejectInput(false);
              clearHalTimer();
              stopHalAudio();
              halActiveKeyRef.current = null;
              setHalSuppressedKeySynced(null);
              resetHalUiState();
            }
            conversationIdRef.current = payload.conversationId;
            setConversationId(payload.conversationId);
            setEvents([]);
            pendingActionsRef.current = [];
            setPendingActions([]);
            agentStatusRef.current = undefined;
            setAgentStatus(undefined);
            setStreamingContent(null);
            eventId.current = 1;
            // No toast: UI clears and restored/started messages will render naturally
            const api = getVscodeApi();
            api.setState?.({ conversationId: payload.conversationId, lastSeenSeq: 0 });
            maybeUpdateHalFlow();
          }
          break;
        case 'workspaceFiles':
          if (Array.isArray(payload.files)) {
            setWorkspaceFiles(payload.files.filter((f): f is string => typeof f === 'string'));
          }
          break;
        case 'skillsList':
          if (Array.isArray(payload.skills)) {
            setSkills(
              payload.skills.filter((skill): skill is { label: string; path: string } => (
                typeof skill === 'object'
                && skill !== null
                && typeof (skill as { label?: unknown }).label === 'string'
                && typeof (skill as { path?: unknown }).path === 'string'
              ))
            );
          }
          break;
        case 'queryUiState': {
          if (typeof payload.requestId === 'string') {
            postMessage({ type: 'uiStateResponse', requestId: payload.requestId, ...uiStateRef.current });
          }
          break;
        }
        case 'queryHalState': {
          if (typeof payload.requestId === 'string') {
            postMessage({ type: 'halStateResponse', requestId: payload.requestId, ...halStateRef.current });
          }
          break;
        }
        case 'e2eAction': {
          if (typeof (payload as { action?: unknown }).action !== 'string') break;
          const action = (payload as { action: string }).action;
          const rawPayload = (payload as { payload?: unknown }).payload;

          switch (action) {
            case 'openContext':
              setShowSkillsPopover(false);
              setShowContextPicker(true);
              postMessage({ type: 'requestWorkspaceFiles' });
              break;
            case 'closeContext':
              setShowContextPicker(false);
              setIsMentionActive(false);
              setContextQuery('');
              mentionStartRef.current = null;
              break;
            case 'toggleContextFile': {
              const file = (rawPayload as { file?: unknown } | undefined)?.file;
              if (typeof file !== 'string' || file.length === 0) break;
              setSelectedContextFiles((prev) => (prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file]));
              break;
            }
            case 'openSkills':
              setShowContextPicker(false);
              setShowSkillsPopover(true);
              postMessage({ type: 'requestSkills' });
              break;
            case 'closeSkills':
              setShowSkillsPopover(false);
              break;
            case 'openAttachments':
              postMessage({ type: 'selectAttachments' });
              break;
            case 'sendMessage': {
              const text = (rawPayload as { text?: unknown } | undefined)?.text;
              if (typeof text !== 'string') break;
              const normalized = text.trim();
              if (!normalized) break;
              postMessage({ type: 'send', text: normalized, contextFiles: [], attachments: [] });
              break;
            }
            case 'setLlmProfileId': {
              const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
              if (profileIdRaw === undefined) break;
              if (profileIdRaw !== null && typeof profileIdRaw !== 'string') break;
              const profileId = profileIdRaw;
              setLlmProfileId(profileId);
              postMessage({ type: 'setLlmProfileId', profileId });
              break;
            }
            case 'halApprove':
              setHalDecision('approve_local');
              postMessage({ type: 'command', command: 'approveAction' });
              break;
            case 'halReject':
              setHalDecision('reject');
              postMessage({ type: 'command', command: 'rejectAction', reason: 'E2E reject' });
              break;
            case 'halTeleport':
              handleHalTeleport();
              break;
            case 'halVoiceConfirmDecision': {
              const decisionRaw = (rawPayload as { decision?: unknown } | undefined)?.decision;
              if (!isHalDecision(decisionRaw)) break;
              cleanupHalVoiceConfirm();
              setHalForceRejectInput(false);
              if (decisionRaw === 'teleport_remote') {
                handleHalTeleport();
                break;
              }
              resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', decision: decisionRaw });
              if (decisionRaw === 'approve_local') {
                postMessage({ type: 'command', command: 'approveAction' });
              } else {
                postMessage({ type: 'command', command: 'rejectAction', reason: 'E2E reject' });
              }
              break;
            }
            case 'halExit':
              handleHalExit();
              break;
          }
          break;
        }
        case 'queryRenderedEvents': {
          const eventSnapshots = events.map(({ event }) => {
            if ('kind' in event && typeof event.kind === 'string') return event.kind;
            if ('type' in event && typeof (event as { type?: unknown }).type === 'string') {
              return (event as { type: string }).type;
            }
            return 'unknown';
          });
          const eventTypes = eventSnapshots;
          const rendered = events.map(({ event }, index) => {
            const type = eventSnapshots[index] ?? 'unknown';
            const marker = (event as { e2e_marker?: unknown }).e2e_marker;
            const toolCallId = (event as { tool_call_id?: unknown }).tool_call_id;
            const role = type === 'MessageEvent'
              ? (event as { llm_message?: { role?: unknown } }).llm_message?.role
              : undefined;
            return {
              type,
              marker: typeof marker === 'string' ? marker : undefined,
              toolCallId: typeof toolCallId === 'string' ? toolCallId : undefined,
              role: typeof role === 'string' ? role : undefined,
            };
          });
          if (typeof payload.requestId === 'string') {
            postMessage({
              type: 'renderedEventsResponse',
              requestId: payload.requestId,
              count: events.length,
              eventTypes,
              events: rendered
            });
          }
          break;
        }
        case 'historyList': {
          const list = Array.isArray(payload.conversations) ? payload.conversations : [];
          setHistory(list);
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [
    cleanupHalFlow,
    cleanupHalVoiceConfirm,
    clearHalTimer,
    disableVoiceConfirmForConversation,
    events,
    handleApprove,
    handleEvent,
    handleHalAudioFinished,
    handleHalExit,
    handleHalTeleport,
    handleReject,
    maybeUpdateHalFlow,
    playHalAudioBytes,
    postMessage,
    resetHalUiState,
    setHalSuppressedKeySynced,
    showStatusMessage,
    stopHalAudio,
  ]);

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
    eventId.current = 1;
    setInput('');
    setSelectedContextFiles([]);
    setAttachments([]);
    setInlineImages([]);
    postMessage({ type: 'command', command: 'startNewConversation' });
  }, [postMessage]);

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true);
    postMessage({ type: 'requestHistory' });
  }, [postMessage]);

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
  }, [attachments, inlineImages, input, postMessage, selectedContextFiles]);

  // Context picker handlers
  const handleOpenContext = useCallback(() => {
    setShowSkillsPopover(false);
    setShowContextPicker((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestWorkspaceFiles' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

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
      const inserted = `@${file} `;
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

  const handleSelectLlmProfileId = useCallback((profileId: string | null) => {
    setLlmProfileId(profileId);
    postMessage({ type: 'setLlmProfileId', profileId });
  }, [postMessage]);

  // Derived state: conversation is empty when no events and no streaming
  const isEmptyConversation = events.length === 0 && streamingContent === null;

  const hasPendingConfirmation = agentStatus === 'WAITING_FOR_CONFIRMATION' && pendingActions.length > 0;
  const hasHighRiskPendingAction = pendingActions.some((action) => action.security_risk === 'HIGH');
  const firstHighRiskAction = pendingActions.find((action) => action.security_risk === 'HIGH');
  const halConversationKey = conversationId ?? 'unknown';
  const voiceConfirmFallbackToButtons =
    elevenlabs.mode === 'voice_confirm' && halVoiceConfirmFallbackKey === halConversationKey;
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
  const halUiLine = halUiPhase === 'dialogue' ? halDialogueLines[halUiStepIndex ?? 0]?.text ?? null : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <Header
        status={status}
        mode={mode}
        conversationId={conversationId}
        currentServerUrl={currentServerUrl}
        servers={servers}
        onNewConversation={handleStartNewConversation}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onReconnect={handleReconnect}
        onSelectServer={handleSelectServer}
        onAddServer={handleAddServer}
        onRemoveServer={handleRemoveServer}
        onSwitchToLocal={handleSwitchToLocal}
      />

      {/* Main conversation area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isEmptyConversation ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-6xl mb-6">🙌</div>
            <h2 className="text-2xl font-semibold mb-3 text-stone-100">Welcome to OpenHands</h2>
            <p className="text-sm text-stone-400 max-w-md leading-relaxed">
              Start a conversation to collaborate with your AI coding assistant.
              Ask questions, request implementations, or get help with your code.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
              <span className="codicon codicon-lightbulb text-brand-400" />
              <span>Type a message below to get started</span>
            </div>
          </div>
        ) : (
          <>
            {events.map((ev, index) => (
              <EventBlock key={ev.id} event={ev.event} index={index} />
            ))}
            {streamingContent !== null && (
              <StreamingMessageBlock content={streamingContent} />
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* HAL overlay (Phase 0: bundled flow replaces confirmation UI) */}
        {shouldShowHalOverlay && (
          <HalOverlay
            key={`hal:${halSessionKey ?? 'none'}:${halForceRejectInput ? 'reject' : 'normal'}`}
            userName={normalizeHalUserName(elevenlabs.userName)}
            mode={elevenlabs.mode}
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
            onExit={handleHalExit}
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
      <div className="relative">
        {/* Status banner (space reserved to prevent layout jumps) */}
        <div className="px-4 pb-2 min-h-[56px] flex items-end" data-testid="status-row">
          {statusBanner && (
            <StatusBanner
              message={statusBanner.message}
              level={statusBanner.level}
              dismissible={statusBanner.dismissible}
              onDismiss={() => setStatusBanner(null)}
              autoDismiss={statusBanner.level !== 'error'}
            />
          )}
        </div>

        <InputArea
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSendMessage}
          disabled={status === 'offline'}
          llmProfileId={llmProfileId}
          llmProfiles={llmProfiles}
          llmProfileLabel={llmProfileLabel}
          onSelectLlmProfileId={handleSelectLlmProfileId}
          onOpenContext={handleOpenContext}
          contextCount={selectedContextFiles.length}
          onOpenSkills={handleOpenSkills}
          skillsCount={skills.length}
          onOpenAttachments={handleOpenAttachments}
          attachments={attachments}
          onOpenAttachment={handleOpenAttachment}
          onRemoveAttachment={handleRemoveAttachment}
          inlineImages={inlineImages}
          onPasteImageFiles={(files) => { void handlePasteImageFiles(files); }}
          onRemoveInlineImage={handleRemoveInlineImage}
          onSelectionChange={handleSelectionChange}
        />

        {/* Context picker popover */}
        <ContextPicker
          isOpen={showContextPicker}
          onClose={() => setShowContextPicker(false)}
          files={workspaceFiles}
          selectedFiles={selectedContextFiles}
          onToggleFile={handleToggleContextFile}
          searchQuery={contextQuery}
          onSearchChange={setContextQuery}
        />

        {/* Skills popover */}
        <SkillsPopover
          isOpen={showSkillsPopover}
          onClose={() => setShowSkillsPopover(false)}
          skills={skills}
          onOpenSkill={handleOpenSkill}
        />
      </div>

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
