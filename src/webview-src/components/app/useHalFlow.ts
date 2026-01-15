import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionEvent } from '@openhands/agent-sdk-ts';
import { getHalDialogueLinesForMode, type HalScriptLine } from '../../../shared/halScript';
import { DEFAULT_HAL_STATE } from '../../../shared/halDefaults';
import { isHalDecision, isHalMode, type HalDecision, type HalEye, type HalPhase, type HalStateSnapshot } from '../../../shared/halTypes';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { ShowStatusMessage } from './useStatusMessages';
import { blobToBase64 } from './halFlow/blobToBase64';
import { DEFAULT_HAL_SETTINGS, DEFAULT_HAL_UI_STATE, type HalSettingsSnapshot, type HalUiState } from './halFlow/types';
import { useHalBundledAudioEffects } from './halFlow/useHalBundledAudio';

export type { HalSettingsSnapshot };

export function useHalFlow(deps: {
  conversationId: string | undefined;
  conversationIdRef: React.MutableRefObject<string | undefined>;
  pendingActionsRef: React.MutableRefObject<ActionEvent[]>;
  agentStatusRef: React.MutableRefObject<string | undefined>;
  postMessage: (msg: WebviewToHostMessage) => void;
  showStatusMessage: ShowStatusMessage;
  handleApprove: () => void;
  handleReject: (reason?: string) => void;
}) {
  const [halSettings, setHalSettings] = useState<HalSettingsSnapshot>(DEFAULT_HAL_SETTINGS);
  const halSettingsRef = useRef<HalSettingsSnapshot>(DEFAULT_HAL_SETTINGS);

  const [halDisabledConversationId, setHalDisabledConversationId] = useState<string | null>(null);
  const [halPhase, setHalPhase] = useState<HalPhase>('idle');
  const [halEye, setHalEye] = useState<HalEye>('off');
  const [halStepIndex, setHalStepIndex] = useState<number | null>(null);
  const [halDecision, setHalDecision] = useState<HalDecision | null>(null);
  const [halLastError, setHalLastError] = useState<string | null>(null);
  const [halForceRejectInput, setHalForceRejectInput] = useState(false);
  const [halTeleporting, setHalTeleporting] = useState(false);
  const [halVoiceConfirmFallbackKey, setHalVoiceConfirmFallbackKey] = useState<string | null>(null);
  const [halSuppressedKey, setHalSuppressedKey] = useState<string | null>(null);

  const halTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const halStepIndexRef = useRef<number | null>(null);
  const halDialogueRef = useRef<HalScriptLine[]>([]);
  const halTtsRequestIdRef = useRef<string | null>(null);
  const halTtsRequestedKeyRef = useRef<string | null>(null);
  const halAudioRef = useRef<HTMLAudioElement | null>(null);
  const halAudioUrlRef = useRef<string | null>(null);
  const halAudioPlayTokenRef = useRef(0);
  const halTtsRequestSeqRef = useRef(0);
  const halVoiceConfirmFallbackKeyRef = useRef<string | null>(null);
  const halVoiceConfirmRequestIdRef = useRef<string | null>(null);
  const halVoiceConfirmSeqRef = useRef(0);
  const halVoiceDiscardNextStopRef = useRef(false);
  const halVoiceStreamRef = useRef<MediaStream | null>(null);
  const halVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const halVoiceChunksRef = useRef<Blob[]>([]);
  const halActiveKeyRef = useRef<string | null>(null);
  const halEnabledRef = useRef<boolean>(false);
  const halPhaseRef = useRef<HalPhase>('idle');
  const halSuppressedKeyRef = useRef<string | null>(null);
  const halTeleportInProgressRef = useRef(false);
  const halStateRef = useRef<HalStateSnapshot>(DEFAULT_HAL_STATE);

  const halSupportedMode = halSettings.mode === 'bundled' || halSettings.mode === 'tts_only' || halSettings.mode === 'voice_confirm';
  const halEnabled = halSettings.enabled && halSupportedMode && halDisabledConversationId !== deps.conversationId;

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
    halSettingsRef.current = halSettings;
  }, [halSettings]);

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
    () => getHalDialogueLinesForMode(halSettings.userName, halSettings.mode),
    [halSettings.mode, halSettings.userName]
  );

  useEffect(() => {
    halDialogueRef.current = halDialogueLines;
  }, [halDialogueLines]);

  const getHalConversationKey = useCallback(() => deps.conversationIdRef.current ?? 'unknown', [deps.conversationIdRef]);

  const maybeUpdateHalFlow = useCallback(() => {
    if (halTeleportInProgressRef.current) return;
    const enabled = halEnabledRef.current;
    const convoId = deps.conversationIdRef.current;
    const isDisabledForConversation = Boolean(convoId) && halDisabledConversationId === convoId;
    const status = deps.agentStatusRef.current;
    const pending = deps.pendingActionsRef.current;
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
  }, [
    clearHalTimer,
    cleanupHalFlow,
    deps.agentStatusRef,
    deps.conversationIdRef,
    deps.pendingActionsRef,
    halDisabledConversationId,
    resetHalUiState,
    setHalSuppressedKeySynced,
    stopHalAudio,
  ]);

  const handleHalAudioFinished = useCallback(() => {
    if (halPhaseRef.current !== 'dialogue') return;
    const currentIndex = halStepIndexRef.current;
    if (currentIndex === null) return;
    const lastIndex = halDialogueRef.current.length - 1;
    if (currentIndex >= lastIndex) {
      resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: null });
      return;
    }
    setHalStepIndex(currentIndex + 1);
  }, [resetHalUiState]);

  useHalBundledAudioEffects({
    halPhase,
    halStepIndex,
    halActiveKeyRef,
    halAudioRef,
    halAudioPlayTokenRef,
    halSettingsRef,
    clearHalTimer,
    stopHalAudio,
    resetHalUiState,
    setHalLastError,
  });

  const playHalAudioBytes = useCallback(
    (bytes: Uint8Array, volume: number, opts: { mimeType?: string } = {}) => {
      stopHalAudio();
      const token = halAudioPlayTokenRef.current;
      const mimeType = opts.mimeType?.trim() || 'audio/mpeg';
      const viewBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([viewBytes], { type: mimeType });
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
    },
    [handleHalAudioFinished, stopHalAudio]
  );

  const requestHalTts = useCallback((params: { conversationId: string; stepIndex: number }) => {
    const requestId = `halTts:${Date.now().toString(36)}:${(halTtsRequestSeqRef.current++).toString(36)}`;
    halTtsRequestIdRef.current = requestId;
    deps.postMessage({
      type: 'halTtsRequest',
      requestId,
      conversationId: params.conversationId,
      stepIndex: params.stepIndex,
    });
  }, [deps.postMessage]);

  useEffect(() => {
    if (halPhase !== 'dialogue') return;
    if (halStepIndex === null) return;
    const mode = halSettingsRef.current.mode;
    if (mode !== 'tts_only' && mode !== 'voice_confirm') return;
    const convoId = deps.conversationIdRef.current;
    if (!convoId) return;
    if (halDisabledConversationId === convoId) return;
    const key = `${convoId}:${halStepIndex}:${mode}`;
    if (halTtsRequestedKeyRef.current === key) return;
    halTtsRequestedKeyRef.current = key;
    requestHalTts({ conversationId: convoId, stepIndex: halStepIndex });
  }, [deps.conversationIdRef, halDisabledConversationId, halPhase, halStepIndex, requestHalTts]);

  const disableVoiceConfirmForConversation = useCallback((message: string) => {
    const key = getHalConversationKey();
    setHalVoiceConfirmFallbackKey(key);
    halVoiceConfirmFallbackKeyRef.current = key;
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', lastError: message });
    deps.showStatusMessage('warn', message);
  }, [cleanupHalVoiceConfirm, deps.showStatusMessage, getHalConversationKey, resetHalUiState]);

  const handleStartVoiceConfirm = useCallback(() => {
    void (async () => {
      if (halPhaseRef.current !== 'awaiting_user') return;
      if (halSettingsRef.current.mode !== 'voice_confirm') return;
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
            deps.postMessage({
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
  }, [cleanupHalVoiceConfirm, deps.postMessage, disableVoiceConfirmForConversation, getHalConversationKey]);

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
    deps.showStatusMessage('info', 'Switched to button decision for this conversation.');
  }, [cleanupHalVoiceConfirm, deps.showStatusMessage, getHalConversationKey, resetHalUiState]);

  const handleHalExit = useCallback((opts?: { sessionKey?: string | null }) => {
    if (halTeleportInProgressRef.current || halPhaseRef.current === 'waiting_remote') {
      deps.postMessage({ type: 'command', command: 'cancelTeleportAction' });
    }
    cleanupHalFlow();
    halTeleportInProgressRef.current = false;
    setHalTeleporting(false);
    setHalForceRejectInput(false);
    const key = typeof opts?.sessionKey === 'string' && opts.sessionKey.length > 0
      ? opts.sessionKey
      : halActiveKeyRef.current;
    if (key) {
      setHalSuppressedKeySynced(key);
    }
    resetHalUiState();
  }, [cleanupHalFlow, deps.postMessage, resetHalUiState, setHalSuppressedKeySynced]);

  const handleHalApprove = useCallback(() => {
    setHalDecision('approve_local');
    deps.handleApprove();
  }, [deps.handleApprove]);

  const handleHalReject = useCallback((reason?: string) => {
    setHalDecision('reject');
    deps.handleReject(reason);
  }, [deps.handleReject]);

  const handleHalTeleport = useCallback(() => {
    cleanupHalFlow();
    halTeleportInProgressRef.current = true;
    setHalTeleporting(true);
    setHalForceRejectInput(false);
    resetHalUiState({ phase: 'waiting_remote', eye: 'pulsating', decision: 'teleport_remote' });
    deps.showStatusMessage('info', 'Teleporting to remote runtime…');
    deps.postMessage({ type: 'command', command: 'teleportAction' });
  }, [cleanupHalFlow, deps.postMessage, deps.showStatusMessage, resetHalUiState]);

  const applyHalSettings = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const prev = halSettingsRef.current;
    const next: HalSettingsSnapshot = { ...prev };
    const payload = raw as Partial<HalSettingsSnapshot> & { [k: string]: unknown };
    if (typeof payload.enabled === 'boolean') next.enabled = payload.enabled;
    if (isHalMode(payload.mode)) next.mode = payload.mode;
    if (typeof payload.userName === 'string') next.userName = payload.userName;
    if (typeof payload.volume === 'number' && Number.isFinite(payload.volume)) {
      next.volume = Math.min(1, Math.max(0, payload.volume));
    }
    halSettingsRef.current = next;
    halEnabledRef.current = next.enabled && (next.mode === 'bundled' || next.mode === 'tts_only' || next.mode === 'voice_confirm');
    setHalSettings(next);
    maybeUpdateHalFlow();
  }, [maybeUpdateHalFlow]);

  const handleHalTtsResponse = useCallback((payload: unknown) => {
    const currentRequestId = halTtsRequestIdRef.current;
    const requestId = (payload as { requestId?: unknown } | undefined)?.requestId;
    if (!currentRequestId || typeof requestId !== 'string' || requestId !== currentRequestId) return;
    halTtsRequestIdRef.current = null;

    const ok = (payload as { ok?: unknown } | undefined)?.ok;
    if (ok === true) {
      const base64 = (payload as { audioBase64?: unknown } | undefined)?.audioBase64;
      if (typeof base64 !== 'string' || base64.length === 0) {
        handleHalAudioFinished();
        return;
      }
      const volume = (payload as { volume?: unknown } | undefined)?.volume;
      const mimeType = (payload as { mimeType?: unknown } | undefined)?.mimeType;
      try {
        const rawAudio = atob(base64);
        const bytes = new Uint8Array(rawAudio.length);
        for (let i = 0; i < rawAudio.length; i += 1) {
          bytes[i] = rawAudio.charCodeAt(i);
        }
        playHalAudioBytes(bytes, typeof volume === 'number' ? volume : halSettingsRef.current.volume, {
          mimeType: typeof mimeType === 'string' ? mimeType : undefined,
        });
      } catch {
        handleHalAudioFinished();
      }
      return;
    }

    const shouldNotify = (payload as { shouldNotify?: unknown } | undefined)?.shouldNotify === true;
    const error = (payload as { error?: unknown } | undefined)?.error;
    const message = typeof error === 'string' && error.trim() ? error.trim() : 'HAL TTS failed';
    const convoId = deps.conversationIdRef.current;
    if (convoId) setHalDisabledConversationId(convoId);

    halTeleportInProgressRef.current = false;
    cleanupHalFlow();
    halActiveKeyRef.current = null;
    setHalSuppressedKeySynced(null);
    resetHalUiState();
    setHalForceRejectInput(false);
    setHalTeleporting(false);

    if (shouldNotify) deps.showStatusMessage('error', `HAL audio disabled for this conversation: ${message}`);
  }, [
    cleanupHalFlow,
    deps.conversationIdRef,
    deps.showStatusMessage,
    handleHalAudioFinished,
    playHalAudioBytes,
    resetHalUiState,
    setHalSuppressedKeySynced,
  ]);

    const applyHalVoiceConfirmDecision = useCallback((decision: HalDecision, options?: { rejectReason?: string }) => {
      cleanupHalVoiceConfirm();
      setHalForceRejectInput(false);

      if (decision === 'teleport_remote') {
        handleHalTeleport();
        return;
      }

      resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', decision });
      if (decision === 'approve_local') {
        deps.handleApprove();
      } else {
        deps.handleReject(options?.rejectReason);
      }
    }, [cleanupHalVoiceConfirm, deps.handleApprove, deps.handleReject, handleHalTeleport, resetHalUiState]);

    const handleHalVoiceConfirmResponse = useCallback((payload: unknown) => {
      const currentRequestId = halVoiceConfirmRequestIdRef.current;
      const requestId = (payload as { requestId?: unknown } | undefined)?.requestId;
      if (!currentRequestId || typeof requestId !== 'string' || requestId !== currentRequestId) return;
      halVoiceConfirmRequestIdRef.current = null;

    const ok = (payload as { ok?: unknown } | undefined)?.ok;
      if (ok === true) {
        const decisionRaw = (payload as { decision?: unknown } | undefined)?.decision;
        if (!isHalDecision(decisionRaw)) {
          disableVoiceConfirmForConversation('Gemini returned an invalid decision. Using buttons instead.');
          return;
        }

        applyHalVoiceConfirmDecision(decisionRaw);
        return;
      }

    const error = (payload as { error?: unknown } | undefined)?.error;
    const message = typeof error === 'string' && error.trim() ? error.trim() : 'Gemini classification failed';
    disableVoiceConfirmForConversation(message);
    }, [applyHalVoiceConfirmDecision, disableVoiceConfirmForConversation]);

  const handleHalTeleportUnavailable = useCallback((error: unknown) => {
    if (halPhaseRef.current === 'idle' && halSuppressedKeyRef.current && halSuppressedKeyRef.current === halActiveKeyRef.current) {
      return;
    }
    const message = typeof error === 'string' && error.trim() ? error.trim() : 'No server available';
    halTeleportInProgressRef.current = false;
    setHalTeleporting(false);
    setHalForceRejectInput(true);
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', lastError: message });
    deps.showStatusMessage('error', message);
  }, [deps.showStatusMessage, resetHalUiState]);

  const handleHalTeleportFailed = useCallback((error: unknown, serverUrl?: string) => {
    if (halPhaseRef.current === 'idle' && halSuppressedKeyRef.current && halSuppressedKeyRef.current === halActiveKeyRef.current) {
      return;
    }
    const rawMessage = typeof error === 'string' && error.trim() ? error.trim() : 'Teleport failed';
    const message = serverUrl
      ? `Remote server is not available at this time.\n${serverUrl}`
      : 'Remote server is not available at this time.';
    const serverInfo = serverUrl ? ` (${serverUrl})` : '';
    halTeleportInProgressRef.current = false;
    setHalTeleporting(false);
    setHalForceRejectInput(false);
    resetHalUiState({ phase: 'error', eye: 'dim', lastError: message });
    deps.showStatusMessage('error', `${rawMessage}${serverInfo}`);
  }, [deps.showStatusMessage, resetHalUiState]);

  const handleHalTeleportStarting = useCallback((serverUrl: string, serverLabel?: string) => {
    if (halPhaseRef.current === 'idle' && halSuppressedKeyRef.current && halSuppressedKeyRef.current === halActiveKeyRef.current) {
      return;
    }
    const displayName = serverLabel || serverUrl;
    deps.showStatusMessage('info', `Connecting to ${displayName}…`);
  }, [deps.showStatusMessage]);

  const handleHalTeleportCanceled = useCallback(() => {
    halTeleportInProgressRef.current = false;
    setHalTeleporting(false);
    setHalForceRejectInput(false);
    stopHalAudio();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', decision: null });
  }, [resetHalUiState, stopHalAudio]);

  const handleHalTeleportSuccess = useCallback((serverUrl: string, serverLabel?: string) => {
    if (halPhaseRef.current === 'idle' && halSuppressedKeyRef.current && halSuppressedKeyRef.current === halActiveKeyRef.current) {
      return;
    }
    const displayName = serverLabel || serverUrl;
    deps.showStatusMessage('info', `Teleported to ${displayName}!`);
    // Note: The HAL UI state will be reset by handleConversationStarted when the new conversation starts
  }, [deps.showStatusMessage]);

  const handleConversationStarted = useCallback(() => {
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
  }, [cleanupHalVoiceConfirm, clearHalTimer, resetHalUiState, setHalSuppressedKeySynced, stopHalAudio]);

  useEffect(() => {
    halStateRef.current = {
      enabled: halEnabled,
      mode: halSettings.mode,
      phase: halPhase,
      eye: halEye,
      stepIndex: halStepIndex,
      decision: halDecision,
      lastError: halLastError,
    };
  }, [halDecision, halEnabled, halEye, halLastError, halPhase, halSettings.mode, halStepIndex]);

  return {
    halSettings,
    applyHalSettings,
    halEnabled,
    halDisabledConversationId,
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
  };
}
