import { useCallback, useEffect, useRef, useState } from 'react';
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
  type LLMConfiguration,
} from '@openhands/agent-sdk-ts';
import { initialLlmStreamingState, reduceLlmStreamingState } from '../../shared/llmStreaming';
import { normalizeHalUserName } from '../../shared/halScript';
import { getVscodeApi } from '../shared/vscodeApi';
import { MAX_RENDERED_EVENTS } from '../shared/constants';
import { MAX_PASTED_IMAGE_BYTES, MAX_PASTED_IMAGES } from '../../shared/pasteLimits';
import { escapeMarkdownAltText } from './app/pastedImages';
import { useHalFlow, type ElevenLabsSettingsSnapshot } from './app/useHalFlow';
import { useInlineImageAttachments } from './app/useInlineImageAttachments';
import { useStatusMessages, type StatusBannerState } from './app/useStatusMessages';

// Component imports
import { Header } from './Header';
import { InputArea, ContextPicker, SkillsPopover } from './InputArea';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { StatusBanner } from './StatusBanner';
import { HistoryView } from './HistoryView';
import { LlmProfilesView, type LlmProfilesViewOpenRequest } from './LlmProfilesView';
import { isHalDecision, type HalPhase } from '../../shared/halTypes';
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

type ConversationTotals = {
  contextTokens: number;
  totalTokens: number;
  totalCost: number;
  costIsKnown: boolean;
};

const INITIAL_CONVERSATION_TOTALS: ConversationTotals = {
  contextTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  costIsKnown: false,
};

const LLM_PROFILES_REQUEST_TIMEOUT_MS = 15_000;

const computeConversationTotalsFromStats = (value: unknown): ConversationTotals | null => {
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    !!candidate && typeof candidate === 'object';
  const asFiniteNumber = (raw: unknown): number | null => {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(num) ? num : null;
  };

  if (!isRecord(value)) return null;
  const usageToMetricsRaw = value.usage_to_metrics ?? value.usageToMetrics ?? value.service_to_metrics ?? value.serviceToMetrics;
  if (!isRecord(usageToMetricsRaw)) return null;

  let contextTokens = 0;
  let completionTokens = 0;
  let totalCost = 0;

  for (const metricRaw of Object.values(usageToMetricsRaw)) {
    if (!isRecord(metricRaw)) continue;
    const costRaw = metricRaw.accumulatedCost ?? metricRaw.accumulated_cost;
    const cost = asFiniteNumber(costRaw);
    if (cost !== null && cost > 0) totalCost += cost;

    const usageRaw = metricRaw.accumulatedTokenUsage ?? metricRaw.accumulated_token_usage;
    if (!isRecord(usageRaw)) continue;
    const prompt = asFiniteNumber(usageRaw.promptTokens ?? usageRaw.prompt_tokens);
    if (prompt !== null && prompt > 0) contextTokens += prompt;
    const completion = asFiniteNumber(usageRaw.completionTokens ?? usageRaw.completion_tokens);
    if (completion !== null && completion > 0) completionTokens += completion;
  }

  const totalTokens = contextTokens + completionTokens;
  // Best-effort: treat cost as "known" only once we have non-zero usage + non-zero cost.
  const costIsKnown = totalTokens > 0 && totalCost > 0;

  return { contextTokens, totalTokens, totalCost, costIsKnown };
};

type PendingLlmProfilesRequest =
  | {
    kind: 'list';
    resolve: (profiles: string[]) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'load';
    resolve: (profile: LLMConfiguration) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'save';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'delete';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'apiKeyStatus';
    resolve: (hasKey: boolean) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
  | {
    kind: 'apiKeySet';
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  };

/**
 * Event dispatcher: routes agent-sdk events to appropriate rendering components.
 */
function EventBlock({
  event,
  index,
  skills,
}: {
  event: Event;
  index: number;
  skills: { label: string; path: string }[];
}) {
  if (isSystemPromptEvent(event)) return <SystemPromptEventBlock event={event} index={index} skills={skills} />;
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

  // History state
  const [history, setHistory] = useState<Array<{ id: string; title?: string; firstMessage?: string; timestamp: number; messageCount?: number }>>([]);

  // Server selection state
  const [servers, setServers] = useState<{ url: string; label?: string }[]>([]);
  const [currentServerUrl, setCurrentServerUrl] = useState<string | undefined>(undefined);

  // Conversation refs (used for HAL + event processing without stale closures)
  const pendingActionsRef = useRef<ActionEvent[]>([]);
  const agentStatusRef = useRef<string | undefined>(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const currentServerUrlRef = useRef<string | undefined>(undefined);

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

  const llmProfilesRequestSeqRef = useRef(1);
  const pendingLlmProfilesRequestsRef = useRef<Map<string, PendingLlmProfilesRequest>>(new Map());

  const createLlmProfilesRequestId = (kind: string): string =>
    `llmProfiles:${kind}:${llmProfilesRequestSeqRef.current++}`;

  const listLlmProfiles = useCallback(async (): Promise<string[]> => {
    const requestId = createLlmProfilesRequestId('list');
    return await new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out listing LLM profiles'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'list', resolve, reject, timeout });
      postMessage({ type: 'llmProfilesListRequest', requestId });
    });
  }, [postMessage]);

  const loadLlmProfile = useCallback(async (profileId: string): Promise<LLMConfiguration> => {
    const requestId = createLlmProfilesRequestId('load');
    return await new Promise<LLMConfiguration>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out loading LLM profile'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'load', resolve, reject, timeout });
      postMessage({ type: 'llmProfileLoadRequest', requestId, profileId });
    });
  }, [postMessage]);

  const saveLlmProfile = useCallback(async (profileId: string, profile: LLMConfiguration): Promise<void> => {
    const requestId = createLlmProfilesRequestId('save');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out saving LLM profile'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'save', resolve, reject, timeout });
      postMessage({ type: 'llmProfileSaveRequest', requestId, profileId, profile });
    });
  }, [postMessage]);

  const deleteLlmProfile = useCallback(async (profileId: string): Promise<void> => {
    const requestId = createLlmProfilesRequestId('delete');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out deleting LLM profile'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'delete', resolve, reject, timeout });
      postMessage({ type: 'llmProfileDeleteRequest', requestId, profileId });
    });
  }, [postMessage]);

  const getLlmProfileApiKeyStatus = useCallback(async (profileId: string): Promise<boolean> => {
    const requestId = createLlmProfilesRequestId('apiKeyStatus');
    return await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out fetching LLM profile API key status'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'apiKeyStatus', resolve, reject, timeout });
      postMessage({ type: 'llmProfileApiKeyStatusRequest', requestId, profileId });
    });
  }, [postMessage]);

  const setLlmProfileApiKey = useCallback(async (profileId: string, apiKey: string): Promise<void> => {
    const requestId = createLlmProfilesRequestId('apiKeySet');
    return await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingLlmProfilesRequestsRef.current.delete(requestId);
        reject(new Error('Timed out setting LLM profile API key'));
      }, LLM_PROFILES_REQUEST_TIMEOUT_MS);
      pendingLlmProfilesRequestsRef.current.set(requestId, { kind: 'apiKeySet', resolve, reject, timeout });
      postMessage({ type: 'llmProfileApiKeySetRequest', requestId, profileId, apiKey });
    });
  }, [postMessage]);

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

  const {
    elevenlabs,
    applyElevenlabsSettings,
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
    handleConversationStarted,
    resetForServerTargetChange,
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

    if (event.key === 'stats') {
      const totals = computeConversationTotalsFromStats(event.value);
      if (totals) {
        setConversationTotals((prev) => {
          if (
            prev.contextTokens === totals.contextTokens
            && prev.totalTokens === totals.totalTokens
            && prev.totalCost === totals.totalCost
            && prev.costIsKnown === totals.costIsKnown
          ) {
            return prev;
          }
          return totals;
        });
      }
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
    } else if (isConversationErrorEvent(event) && event.code === 'missing_llm_api_key') {
      showStatusMessage('error', 'Missing API key. Set it in LLM Profiles.', { autoDismiss: true, autoDismissDelay: 8000 });
    } else if (isPauseEvent(event)) {
      showStatusMessage('warn', 'Conversation paused');
    }
  }, [showStatusMessage]);

  const handleRenderableEvent = useCallback((event: Event) => {
    if (!isRenderableEvent(event)) return;

    setEvents((ev) => {
      const next = [...ev, { id: eventId.current++, event }];
      return next.length > MAX_RENDERED_EVENTS ? next.slice(-MAX_RENDERED_EVENTS) : next;
    });
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
        ok?: unknown;
        status?: 'online' | 'offline' | 'connecting';
        serverUrl?: string | null;
        mode?: 'local' | 'remote';
        llmProfileLabel?: string | null;
        profiles?: string[];
        activeProfileId?: string | null;
        profileId?: unknown;
        profile?: unknown;
        hasKey?: unknown;
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
        level?: unknown;
        message?: unknown;
        autoDismiss?: unknown;
        autoDismissDelay?: unknown;
      };

      switch (payload?.type) {
        case 'status':
          if (payload.status) {
            setStatus(payload.status);
            if (payload.mode === 'local' || payload.mode === 'remote') {
              setMode(payload.mode);
            }
            const label = payload.llmProfileLabel;
            if (typeof label === 'string' || label === null) {
              setLlmProfileLabel(label);
            }
            const nextBanner: StatusBannerState | null =
              payload.mode === 'local'
                ? { message: 'Local mode: running without remote server', level: 'info', dismissible: false }
                : payload.status === 'connecting'
                  ? { message: 'Connecting to server…', level: 'info' }
                  : payload.status === 'online'
                    ? { message: 'Connected to server', level: 'info' }
                    : payload.status === 'offline'
                      ? { message: 'Disconnected from server', level: 'warn' }
                      : null;

            if (nextBanner) {
              setStatusBanner((prev) => {
                if (!prev) return nextBanner;
                if (
                  prev.message === nextBanner.message
                  && prev.level === nextBanner.level
                  && prev.dismissible === nextBanner.dismissible
                ) {
                  return prev;
                }
                return nextBanner;
              });
            }
          }
          break;
        case 'statusMessage': {
          const level = payload.level;
          const message = payload.message;
          if ((level === 'info' || level === 'warn' || level === 'error') && typeof message === 'string' && message.trim()) {
            const autoDismiss = payload.autoDismiss === true;
            const autoDismissDelay = typeof payload.autoDismissDelay === 'number' && Number.isFinite(payload.autoDismissDelay)
              ? Math.max(0, payload.autoDismissDelay)
              : undefined;
            showStatusMessage(level, message.trim(), { autoDismiss, autoDismissDelay });
          }
          break;
        }
        case 'llmProfilesUpdated': {
          if (Array.isArray(payload.profiles)) {
            setLlmProfiles(payload.profiles.filter((id): id is string => typeof id === 'string'));
          }
          if (typeof payload.activeProfileId === 'string' || payload.activeProfileId === null) {
            setLlmProfileId(payload.activeProfileId);
          }
          break;
        }
        case 'llmProfilesListResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'list') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true && Array.isArray(payload.profiles)) {
            pending.resolve(payload.profiles.filter((id): id is string => typeof id === 'string' && id.trim().length > 0));
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to list LLM profiles';
          pending.reject(new Error(reason));
          break;
        }
        case 'llmProfileLoadResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'load') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true && payload.profile && typeof payload.profile === 'object') {
            pending.resolve(payload.profile as LLMConfiguration);
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to load LLM profile';
          pending.reject(new Error(reason));
          break;
        }
        case 'llmProfileSaveResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'save') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true) {
            pending.resolve();
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to save LLM profile';
          pending.reject(new Error(reason));
          break;
        }
        case 'llmProfileDeleteResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'delete') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true) {
            pending.resolve();
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to delete LLM profile';
          pending.reject(new Error(reason));
          break;
        }
        case 'llmProfileApiKeyStatusResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'apiKeyStatus') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true && typeof payload.hasKey === 'boolean') {
            pending.resolve(payload.hasKey);
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to fetch LLM profile API key status';
          pending.reject(new Error(reason));
          break;
        }
        case 'llmProfileApiKeySetResponse': {
          const requestId = payload.requestId;
          if (typeof requestId !== 'string') break;
          const pending = pendingLlmProfilesRequestsRef.current.get(requestId);
          if (!pending || pending.kind !== 'apiKeySet') break;
          pendingLlmProfilesRequestsRef.current.delete(requestId);
          clearTimeout(pending.timeout);
          if (payload.ok === true) {
            pending.resolve();
            break;
          }
          const reason = typeof payload.error === 'string' ? payload.error : 'Failed to set LLM profile API key';
          pending.reject(new Error(reason));
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
              resetForServerTargetChange();
              conversationIdRef.current = undefined;
              setConversationId(undefined);
              setEvents([]);
              pendingActionsRef.current = [];
              setPendingActions([]);
              agentStatusRef.current = undefined;
              setAgentStatus(undefined);
              setStreamingContent(null);
              setConversationTotals(INITIAL_CONVERSATION_TOTALS);
              eventId.current = 1;
              const api = getVscodeApi();
              api.setState?.({});
              maybeUpdateHalFlow();
            }
          }
          break;
        }
        case 'elevenlabsSettings':
          applyElevenlabsSettings(payload.elevenlabs);
          break;
        case 'halTtsResponse': {
          handleHalTtsResponse(payload);
          break;
        }
        case 'halVoiceConfirmResponse': {
          handleHalVoiceConfirmResponse(payload);
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
          handleHalTeleportUnavailable(payload.error);
          break;
        }
        case 'halTeleportFailed': {
          handleHalTeleportFailed(payload.error);
          break;
        }
        case 'conversationStarted':
          if (typeof payload.conversationId === 'string') {
            handleConversationStarted();
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
            case 'openLlmProfilesView': {
              const mode = (rawPayload as { mode?: unknown } | undefined)?.mode;
              const profileIdRaw = (rawPayload as { profileId?: unknown } | undefined)?.profileId;
              setShowLlmProfiles(true);
              if (mode === 'create') {
                setLlmProfilesOpenRequest({ mode: 'create' });
                break;
              }
              if (mode === 'edit' && typeof profileIdRaw === 'string' && profileIdRaw.trim()) {
                setLlmProfilesOpenRequest({ mode: 'edit', profileId: profileIdRaw.trim() });
                break;
              }
              setLlmProfilesOpenRequest(null);
              break;
            }
            case 'closeLlmProfilesView':
              setShowLlmProfiles(false);
              setLlmProfilesOpenRequest(null);
              break;
            case 'halApprove':
              handleHalApprove();
              break;
            case 'halReject':
              handleHalReject('E2E reject');
              break;
            case 'halTeleport':
              handleHalTeleport();
              break;
            case 'halVoiceConfirmDecision': {
              const decisionRaw = (rawPayload as { decision?: unknown } | undefined)?.decision;
              if (!isHalDecision(decisionRaw)) break;
              applyHalVoiceConfirmDecision(decisionRaw, { rejectReason: 'E2E reject' });
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
      applyElevenlabsSettings,
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
    handleHalTtsResponse,
    handleHalVoiceConfirmResponse,
      maybeUpdateHalFlow,
      postMessage,
      resetForServerTargetChange,
      setStatusBanner,
      showStatusMessage,
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
    eventId.current = 1;
    setInput('');
    setSelectedContextFiles([]);
    setAttachments([]);
    setInlineImages([]);
    postMessage({ type: 'command', command: 'startNewConversation' });
  }, [postMessage, setInlineImages, setStatusBanner]);

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true);
    postMessage({ type: 'requestHistory' });
  }, [postMessage]);

  const handleOpenLlmProfiles = useCallback(() => {
    setLlmProfilesOpenRequest(null);
    setShowLlmProfiles(true);
  }, []);

  const handleOpenLlmProfilesCreate = useCallback(() => {
    setLlmProfilesOpenRequest({ mode: 'create' });
    setShowLlmProfiles(true);
  }, []);

  const handleOpenLlmProfilesEdit = useCallback((profileId: string) => {
    setLlmProfilesOpenRequest({ mode: 'edit', profileId });
    setShowLlmProfiles(true);
  }, []);

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
  }, [attachments, inlineImages, input, postMessage, selectedContextFiles, setInlineImages]);

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

      {/* Main conversation area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isEmptyConversation ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-6xl mb-6">🙌</div>
            <h2 className="text-2xl font-semibold mb-3 text-stone-100">Welcome to OpenHands</h2>
            <p className="text-sm text-stone-400 max-w-md leading-relaxed">
              Start a conversation to collaborate with your AI agent.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
              <span className="codicon codicon-lightbulb text-brand-400" />
              <span>Type a message below to get started</span>
            </div>
          </div>
        ) : (
          <>
            {events.map((ev, index) => (
              <EventBlock key={ev.id} event={ev.event} index={index} skills={skills} />
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
              autoDismiss={statusBanner.autoDismiss ?? statusBanner.level !== 'error'}
              autoDismissDelay={statusBanner.autoDismissDelay}
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
          onOpenLlmProfilesCreate={handleOpenLlmProfilesCreate}
          onOpenLlmProfilesEdit={handleOpenLlmProfilesEdit}
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
        {showContextPicker && (
          <ContextPicker
            isOpen
            onClose={handleCloseContextPicker}
            files={workspaceFiles}
            selectedFiles={selectedContextFiles}
            onToggleFile={handleToggleContextFile}
            searchQuery={contextQuery}
            onSearchChange={setContextQuery}
          />
        )}

        {/* Skills popover */}
      {showSkillsPopover && (
        <SkillsPopover
          isOpen
          onClose={() => setShowSkillsPopover(false)}
          skills={skills}
          onOpenSkill={handleOpenSkill}
        />
      )}
      </div>

      {/* LLM Profiles view (slide-over panel) */}
      <LlmProfilesView
        isOpen={showLlmProfiles}
        onClose={() => setShowLlmProfiles(false)}
        openRequest={llmProfilesOpenRequest}
        listProfiles={listLlmProfiles}
        loadProfile={loadLlmProfile}
        saveProfile={saveLlmProfile}
        deleteProfile={deleteLlmProfile}
        getApiKeyStatus={getLlmProfileApiKeyStatus}
        setApiKey={setLlmProfileApiKey}
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
