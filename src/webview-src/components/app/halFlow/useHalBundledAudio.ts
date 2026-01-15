import { useEffect, useRef } from 'react';
import type { HalPhase } from '../../../../shared/halTypes';
import { describeHalAudioPlaybackFailure, getBundledHalMusicStingUrl, getBundledHalSceneUrl, isAutoplayBlockedError } from './media';
import type { HalSettingsSnapshot, HalUiState } from './types';

export function useHalBundledAudioEffects(options: {
  halPhase: HalPhase;
  halStepIndex: number | null;
  halActiveKeyRef: React.MutableRefObject<string | null>;
  halAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  halAudioPlayTokenRef: React.MutableRefObject<number>;
  halSettingsRef: React.MutableRefObject<HalSettingsSnapshot>;
  clearHalTimer: () => void;
  stopHalAudio: () => void;
  resetHalUiState: (overrides?: Partial<HalUiState>) => void;
  setHalLastError: (error: string | null) => void;
}) {
  const {
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
  } = options;

  const halBundledAudioKeyRef = useRef<string | null>(null);
  const halBundledMusicKeyRef = useRef<string | null>(null);
  const halBundledAudioErrorKeyRef = useRef<string | null>(null);
  const halBundledMusicErrorKeyRef = useRef<string | null>(null);
  const halBundledSceneAutoplayRetryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (halPhase !== 'dialogue') return;
    if (halStepIndex === null) return;
    if (halSettingsRef.current.mode !== 'bundled') return;

    const sessionKey = halActiveKeyRef.current ?? 'unknown';
    if (halBundledAudioKeyRef.current === sessionKey) return;
    halBundledAudioKeyRef.current = sessionKey;

    clearHalTimer();

    const clipUrl = getBundledHalSceneUrl();
    if (!clipUrl || typeof Audio !== 'function') {
      resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: null });
      return;
    }

    const volume = halSettingsRef.current.volume;
    stopHalAudio();
    const token = halAudioPlayTokenRef.current;
    const audio = new Audio(clipUrl);
    halAudioRef.current = audio;
    audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    audio.onended = () => {
      if (halAudioPlayTokenRef.current !== token) return;
      stopHalAudio();
      resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: 0 });
    };

    const fallBackToAwaiting = (error?: unknown) => {
      if (halAudioPlayTokenRef.current !== token) return;
      const errorKey = `${sessionKey}:scene`;
      if (error && isAutoplayBlockedError(error)) {
        halBundledSceneAutoplayRetryKeyRef.current = errorKey;
        const info = describeHalAudioPlaybackFailure(error);
        console.warn(`[HAL] Bundled scene audio failed: ${info.debug}`);
        stopHalAudio();
        resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: 0, lastError: info.message });
        return;
      }
      if (error && halBundledAudioErrorKeyRef.current !== errorKey) {
        halBundledAudioErrorKeyRef.current = errorKey;
        const info = describeHalAudioPlaybackFailure(error);
        console.warn(`[HAL] Bundled scene audio failed: ${info.debug}`);
        stopHalAudio();
        resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: 0, lastError: info.message });
        return;
      }
      stopHalAudio();
      resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: 0 });
    };

    audio.onerror = () => fallBackToAwaiting(audio.error ?? 'Bundled scene audio error');
    void audio.play().catch(fallBackToAwaiting);

    return () => {
      clearHalTimer();
      stopHalAudio();
    };
  }, [clearHalTimer, halActiveKeyRef, halAudioPlayTokenRef, halAudioRef, halPhase, halSettingsRef, halStepIndex, resetHalUiState, setHalLastError, stopHalAudio]);

  useEffect(() => {
    const sessionKey = halActiveKeyRef.current ?? 'unknown';
    const retryKey = `${sessionKey}:scene`;
    if (halBundledSceneAutoplayRetryKeyRef.current !== retryKey) return;
    if (halSettingsRef.current.mode !== 'bundled') return;
    if (halPhase !== 'dialogue' && halPhase !== 'awaiting_user') return;

    const clipUrl = getBundledHalSceneUrl();
    if (!clipUrl || typeof Audio !== 'function') return;

    const retry = () => {
      if (halBundledSceneAutoplayRetryKeyRef.current !== retryKey) return;
      halBundledSceneAutoplayRetryKeyRef.current = null;
      setHalLastError(null);

      const volume = halSettingsRef.current.volume;
      stopHalAudio();
      const token = halAudioPlayTokenRef.current;
      const audio = new Audio(clipUrl);
      halAudioRef.current = audio;
      audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
      audio.onended = () => {
        if (halAudioPlayTokenRef.current !== token) return;
        stopHalAudio();
        resetHalUiState({ phase: 'awaiting_user', eye: 'pulsating', stepIndex: 0 });
      };

      const onFail = (error: unknown) => {
        if (halAudioPlayTokenRef.current !== token) return;
        if (isAutoplayBlockedError(error)) {
          halBundledSceneAutoplayRetryKeyRef.current = retryKey;
          const info = describeHalAudioPlaybackFailure(error);
          console.warn(`[HAL] Bundled scene audio failed: ${info.debug}`);
          stopHalAudio();
          setHalLastError(info.message);
          return;
        }
        stopHalAudio();
      };

      audio.onerror = () => onFail(audio.error ?? 'Bundled scene audio error');
      void audio.play().catch(onFail);
    };

    const onPointerDown = () => retry();
    const onKeyDown = () => retry();

    window.addEventListener('pointerdown', onPointerDown, { capture: true, once: true });
    window.addEventListener('keydown', onKeyDown, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [halActiveKeyRef, halAudioPlayTokenRef, halAudioRef, halPhase, halSettingsRef, resetHalUiState, setHalLastError, stopHalAudio]);

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

    const volume = halSettingsRef.current.volume;
    stopHalAudio();
    const token = halAudioPlayTokenRef.current;
    const audio = new Audio(url);
    halAudioRef.current = audio;
    audio.loop = true;
    audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));

    const stopWithError = (error: unknown) => {
      if (halAudioPlayTokenRef.current !== token) return;
      const errorKey = `${sessionKey}:music`;
      if (halBundledMusicErrorKeyRef.current !== errorKey) {
        halBundledMusicErrorKeyRef.current = errorKey;
        const info = describeHalAudioPlaybackFailure(error);
        console.warn(`[HAL] Bundled music audio failed: ${info.debug}`);
        resetHalUiState({ phase: 'waiting_remote', eye: 'pulsating', decision: 'teleport_remote', lastError: info.message });
      }
      stopHalAudio();
    };

    audio.onerror = () => stopWithError(audio.error ?? 'Bundled music audio error');
    void audio.play().catch(stopWithError);

    return () => {
      stopHalAudio();
    };
  }, [halActiveKeyRef, halAudioPlayTokenRef, halAudioRef, halPhase, halSettingsRef, resetHalUiState, stopHalAudio]);
}
