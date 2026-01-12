import { useMemo, useState } from 'react';
import type { HalDecision, HalEye, HalMode, HalPhase } from '../../shared/halTypes';

type HalOverlayProps = {
  userName: string;
  mode: HalMode;
  phase: HalPhase;
  eye: HalEye;
  line: string | null;
  decision: HalDecision | null;
  lastError: string | null;
  isSubmitting: boolean;
  startWithRejectInput?: boolean;
  voiceConfirmFallbackToButtons?: boolean;
  onStartVoiceConfirm?: () => void;
  onStopVoiceConfirm?: () => void;
  onCancelVoiceConfirm?: () => void;
  onUseButtonsInstead?: () => void;
  onApprove: () => void;
  onTeleport: () => void;
  onReject: (reason?: string) => void;
  onExit: () => void;
};

export function HalOverlay({
  userName,
  mode,
  phase,
  eye,
  line,
  decision,
  lastError,
  isSubmitting,
  startWithRejectInput,
  voiceConfirmFallbackToButtons,
  onStartVoiceConfirm,
  onStopVoiceConfirm,
  onCancelVoiceConfirm,
  onUseButtonsInstead,
  onApprove,
  onTeleport,
  onReject,
  onExit,
}: HalOverlayProps) {
  const [showRejectInput, setShowRejectInput] = useState(() => Boolean(startWithRejectInput));
  const [rejectReason, setRejectReason] = useState('');

  const title = useMemo(() => {
    if (phase === 'waiting_remote') return 'Teleporting…';
    if (phase === 'error') return 'HAL Error';
    return 'Restricted Area Protocol';
  }, [phase]);

  const subtitle = useMemo(() => {
    if (phase === 'dialogue') return `Hello, ${userName}.`;
    if (phase === 'awaiting_user') {
      if (mode === 'voice_confirm' && !voiceConfirmFallbackToButtons) return 'Hold to talk (voice decision).';
      return 'Please choose an action.';
    }
    if (phase === 'listening') return 'Listening…';
    if (phase === 'classifying') return 'Classifying decision…';
    if (phase === 'waiting_remote') return 'Preparing remote runtime…';
    if (phase === 'error') return 'The HAL flow encountered an error.';
    return '';
  }, [mode, phase, userName, voiceConfirmFallbackToButtons]);

  const showVoiceConfirmControls =
    mode === 'voice_confirm' &&
    !voiceConfirmFallbackToButtons &&
    decision === null &&
    (phase === 'awaiting_user' || phase === 'listening' || phase === 'classifying');
  const showDecisionButtons = phase === 'awaiting_user' && decision === null && !showRejectInput && !showVoiceConfirmControls;

  const canSubmit = !isSubmitting && phase === 'awaiting_user';

  const handleRejectClick = () => {
    if (!canSubmit) return;
    setShowRejectInput(true);
  };

  const handleCancelReject = () => {
    setShowRejectInput(false);
    setRejectReason('');
  };

  const handleConfirmReject = () => {
    if (!canSubmit) return;
    onReject(rejectReason.trim() || undefined);
    setShowRejectInput(false);
    setRejectReason('');
  };

  const isPulsating = eye === 'pulsating';
  const exitDisabled = isSubmitting && phase !== 'waiting_remote';

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" aria-hidden="true" />

      <div className="absolute left-1/2 -translate-x-1/2 bottom-[124px] flex flex-col items-center gap-4 pointer-events-auto">
        <div
          className={[
            'relative w-20 h-20 rounded-full border border-red-400/40',
            'bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.35),rgba(239,68,68,0.35)_35%,rgba(0,0,0,0.85)_70%)]',
            isPulsating ? 'animate-pulse shadow-[0_0_24px_rgba(239,68,68,0.35)]' : 'shadow-[0_0_12px_rgba(239,68,68,0.25)]',
          ].join(' ')}
          aria-label="HAL eye"
        >
          <div className="absolute inset-3 rounded-full bg-black/40 border border-red-500/20" />
          <div className="absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-200/80 blur-[0.5px]" />
        </div>

        <div
          className="w-[min(560px,calc(100vw-32px))] rounded-2xl border border-red-400/25 bg-stone-950/90 shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="HAL protocol"
        >
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-stone-100">{title}</div>
              <div className="text-xs text-stone-400 mt-1">{subtitle}</div>
            </div>

            <button
              type="button"
              onClick={onExit}
              disabled={exitDisabled}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-300 hover:bg-white/[0.08] hover:text-stone-200 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Exit
            </button>
          </div>

          <div className="px-5 py-4">
            {lastError && (
              <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded-lg p-3">
                {lastError}
              </div>
            )}

            {line && (
              <div className="font-mono text-sm text-stone-200 bg-black/30 border border-white/[0.06] rounded-xl p-4">
                {line}
              </div>
            )}

            {phase === 'dialogue' && (
              <div className="mt-3 text-xs text-stone-500">
                {decision ? `Decision: ${decision}` : '…'}
              </div>
            )}

            {decision && phase !== 'dialogue' && (
              <div className="mt-3 text-xs text-stone-500">
                Decision: {decision}
              </div>
            )}

            {showVoiceConfirmControls && (
              <div className="mt-4">
                <div className="text-xs text-stone-400">
                  Say one of: <span className="text-stone-200">approve locally</span>, <span className="text-stone-200">teleport</span>, or{' '}
                  <span className="text-stone-200">reject</span>.
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {phase === 'awaiting_user' && (
                    <button
                      type="button"
                      onClick={onStartVoiceConfirm}
                      disabled={!canSubmit}
                      className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 text-white text-sm font-medium transition-all shadow-glow-sm hover:from-brand-400 hover:to-brand-500 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="codicon codicon-mic" />
                      Record decision
                    </button>
                  )}
                  {phase === 'listening' && (
                    <>
                      <button
                        type="button"
                        onClick={onCancelVoiceConfirm}
                        disabled={isSubmitting}
                        className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:bg-white/[0.08] hover:text-stone-300 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={onStopVoiceConfirm}
                        disabled={isSubmitting}
                        className="px-4 py-2.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 text-sm font-medium transition-all border border-red-400/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <span className="codicon codicon-primitive-square" />
                        Stop
                      </button>
                    </>
                  )}
                  {phase === 'classifying' && (
                    <div className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-300 text-sm font-medium flex items-center gap-2">
                      <span className="codicon codicon-loading animate-spin" />
                      Working…
                    </div>
                  )}
                  {(phase === 'awaiting_user' || phase === 'listening' || phase === 'classifying') && (
                    <button
                      type="button"
                      onClick={onUseButtonsInstead}
                      disabled={isSubmitting}
                      className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:bg-white/[0.08] hover:text-stone-300 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Use buttons instead
                    </button>
                  )}
                </div>
              </div>
            )}

            {showDecisionButtons && (
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRejectClick}
                  disabled={!canSubmit}
                  className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-300 hover:bg-white/[0.08] hover:text-stone-200 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 oh-focus-outline"
                >
                  <span className="codicon codicon-close" />
                  Reject
                </button>

                <button
                  type="button"
                  onClick={onTeleport}
                  disabled={!canSubmit}
                  className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-400/25 text-red-200 hover:bg-red-500/20 hover:text-red-100 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 oh-focus-outline"
                >
                  <span className="codicon codicon-run-all" />
                  Teleport to Remote
                </button>

                <button
                  type="button"
                  onClick={onApprove}
                  disabled={!canSubmit}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 text-white text-sm font-medium transition-all shadow-glow-sm hover:from-brand-400 hover:to-brand-500 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
                >
                  <span className="codicon codicon-check" />
                  Approve Locally
                </button>
              </div>
            )}

            {phase === 'awaiting_user' && showRejectInput && (
              <div className="mt-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl animate-slide-down">
                <label htmlFor="hal-reject-reason" className="block text-sm font-medium text-stone-300 mb-2">
                  Reason for rejection (optional):
                </label>
                <textarea
                  id="hal-reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for rejection (optional)"
                  rows={3}
                  className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-lg text-sm text-stone-200 placeholder:text-stone-500 resize-none focus:outline-none focus:ring-0 focus:border-white/[0.08] focus:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]"
                  autoFocus
                />
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelReject}
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:bg-white/[0.08] hover:text-stone-300 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReject}
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm font-medium transition-all border border-red-400/30 disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
