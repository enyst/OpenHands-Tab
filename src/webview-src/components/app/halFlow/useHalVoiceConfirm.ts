import { useCallback, useEffect, useRef } from 'react';
import { isHalDecision, type HalDecision, type HalEye, type HalPhase } from '../../../../shared/halTypes';
import type { WebviewToHostMessage } from '../../../../shared/webviewMessages';
import type { ShowStatusMessage } from '../useStatusMessages';
import { blobToBase64 } from './blobToBase64';
import type { HalSettingsSnapshot, HalUiState } from './types';

interface UseHalVoiceConfirmArgs {
  halPhaseRef: React.MutableRefObject<HalPhase>;
  halSettingsRef: React.MutableRefObject<HalSettingsSnapshot>;
  halActiveKeyRef: React.MutableRefObject<string | null>;
  getHalConversationKey: () => string;
  postMessage: (msg: WebviewToHostMessage) => void;
  showStatusMessage: ShowStatusMessage;
  resetHalUiState: (overrides?: Partial<HalUiState>) => void;
  setHalPhase: React.Dispatch<React.SetStateAction<HalPhase>>;
  setHalEye: React.Dispatch<React.SetStateAction<HalEye>>;
  setHalLastError: React.Dispatch<React.SetStateAction<string | null>>;
  setHalVoiceConfirmFallbackKey: React.Dispatch<React.SetStateAction<string | null>>;
  halVoiceConfirmFallbackKey: string | null;
}

export function useHalVoiceConfirm({
  halPhaseRef,
  halSettingsRef,
  halActiveKeyRef,
  getHalConversationKey,
  postMessage,
  showStatusMessage,
  resetHalUiState,
  setHalPhase,
  setHalEye,
  setHalLastError,
  setHalVoiceConfirmFallbackKey,
  halVoiceConfirmFallbackKey,
}: UseHalVoiceConfirmArgs) {
  const halVoiceConfirmFallbackKeyRef = useRef<string | null>(null);
  const halVoiceConfirmRequestIdRef = useRef<string | null>(null);
  const halVoiceConfirmSeqRef = useRef(0);
  const halVoiceDiscardNextStopRef = useRef(false);
  const halVoiceStreamRef = useRef<MediaStream | null>(null);
  const halVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const halVoiceChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    halVoiceConfirmFallbackKeyRef.current = halVoiceConfirmFallbackKey;
  }, [halVoiceConfirmFallbackKey]);

  const cleanupHalVoiceConfirm = useCallback(() => {
    const recorder = halVoiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        halVoiceDiscardNextStopRef.current = true;
        recorder.stop();
      } catch {
        // ignore
      }
    }
    halVoiceRecorderRef.current = null;
    halVoiceChunksRef.current = [];
    const stream = halVoiceStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
    halVoiceStreamRef.current = null;
    halVoiceConfirmRequestIdRef.current = null;
  }, []);

  const disableVoiceConfirmForConversation = useCallback((message: string) => {
    const key = getHalConversationKey();
    setHalVoiceConfirmFallbackKey(key);
    halVoiceConfirmFallbackKeyRef.current = key;
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', lastError: message });
    showStatusMessage('warn', message);
  }, [cleanupHalVoiceConfirm, getHalConversationKey, resetHalUiState, setHalVoiceConfirmFallbackKey, showStatusMessage]);

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
          } catch {
            // ignore
          }
        }
        return;
      }

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = candidates.find((type) => {
        try {
          return MediaRecorder.isTypeSupported(type);
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
          } catch {
            // ignore
          }
        }
        disableVoiceConfirmForConversation(`Microphone recording is not supported: ${reason}`);
        return;
      }

      halVoiceStreamRef.current = stream;
      halVoiceRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          halVoiceChunksRef.current.push(event.data);
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
              } catch {
                // ignore
              }
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
          } catch {
            // ignore
          }
        }
        disableVoiceConfirmForConversation(`Failed to start recording: ${reason}`);
      }
    })();
  }, [
    cleanupHalVoiceConfirm,
    disableVoiceConfirmForConversation,
    getHalConversationKey,
    halActiveKeyRef,
    halPhaseRef,
    halSettingsRef,
    postMessage,
    setHalEye,
    setHalLastError,
    setHalPhase,
  ]);

  const handleStopVoiceConfirm = useCallback(() => {
    if (halPhaseRef.current !== 'listening') return;
    const recorder = halVoiceRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      recorder.stop();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      disableVoiceConfirmForConversation(`Failed to stop recording: ${reason}`);
    }
  }, [disableVoiceConfirmForConversation, halPhaseRef]);

  const handleCancelVoiceConfirm = useCallback(() => {
    if (halPhaseRef.current !== 'listening') return;
    halVoiceDiscardNextStopRef.current = true;
    const recorder = halVoiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating' });
  }, [cleanupHalVoiceConfirm, halPhaseRef, resetHalUiState]);

  const handleUseButtonsInstead = useCallback(() => {
    const key = getHalConversationKey();
    setHalVoiceConfirmFallbackKey(key);
    halVoiceConfirmFallbackKeyRef.current = key;
    cleanupHalVoiceConfirm();
    resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating' });
    showStatusMessage('info', 'Switched to button decision for this conversation.');
  }, [cleanupHalVoiceConfirm, getHalConversationKey, resetHalUiState, setHalVoiceConfirmFallbackKey, showStatusMessage]);

  const handleHalVoiceConfirmResponse = useCallback((payload: unknown, onDecision: (decision: HalDecision) => void) => {
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

      onDecision(decisionRaw);
      return;
    }

    const error = (payload as { error?: unknown } | undefined)?.error;
    const message = typeof error === 'string' && error.trim() ? error.trim() : 'Gemini classification failed';
    disableVoiceConfirmForConversation(message);
  }, [disableVoiceConfirmForConversation]);

  return {
    cleanupHalVoiceConfirm,
    handleStartVoiceConfirm,
    handleStopVoiceConfirm,
    handleCancelVoiceConfirm,
    handleUseButtonsInstead,
    handleHalVoiceConfirmResponse,
  };
}
