import { useState } from 'react';
import type { ActionEvent } from '@openhands/agent-sdk-ts';

interface ConfirmationPromptProps {
  pendingActions: ActionEvent[];
  onApprove: () => void;
  onReject: (reason?: string) => void;
  isSubmitting?: boolean;
}

export function ConfirmationPrompt({
  pendingActions,
  onApprove,
  onReject,
  isSubmitting = false,
}: ConfirmationPromptProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = () => {
    onApprove();
  };

  const handleReject = () => {
    if (showRejectInput) {
      onReject(rejectReason.trim() || undefined);
      setShowRejectInput(false);
      setRejectReason('');
    } else {
      setShowRejectInput(true);
    }
  };

  const handleCancel = () => {
    setShowRejectInput(false);
    setRejectReason('');
  };

  if (pendingActions.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative max-w-2xl w-full max-h-[80vh] overflow-hidden rounded-2xl shadow-2xl animate-scale-in"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 30, 30, 0.98) 0%, rgba(20, 20, 20, 0.98) 100%)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 bg-gradient-to-r from-brand-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center animate-pulse-glow">
              <span className="codicon codicon-shield text-xl text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Confirmation Required</h2>
              <p className="text-xs opacity-60 mt-0.5">
                The agent wants to perform {pendingActions.length} action{pendingActions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-96">
          <div className="space-y-3">
            {pendingActions.map((action, index) => {
              const thought = action.thought.map((t) => t.text).join('\n');
              const hasHighRisk = action.security_risk === 'HIGH';

              return (
                <div
                  key={action.tool_call_id || index}
                  className={`
                    p-4 rounded-lg border
                    ${hasHighRisk
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-white/5 border-white/10'
                    }
                  `}
                >
                  {/* Action header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="codicon codicon-play text-blue-400" />
                      <span className="font-mono text-sm text-brand-400">{action.tool_name}</span>
                    </div>
                    {action.security_risk && action.security_risk !== 'UNKNOWN' && (
                      <span
                        className={`
                          inline-flex items-center px-2 py-1 rounded text-xs font-semibold
                          ${action.security_risk === 'HIGH' ? 'bg-red-500/30 text-red-300 border border-red-500/50' :
                            action.security_risk === 'MEDIUM' ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/50' :
                            'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                          }
                        `}
                      >
                        {action.security_risk} RISK
                      </span>
                    )}
                  </div>

                  {/* Thought process */}
                  {thought && (
                    <div className="mb-3 text-sm leading-relaxed opacity-90">
                      <div className="font-medium text-xs uppercase tracking-wide opacity-60 mb-1">
                        Reasoning
                      </div>
                      <div className="italic">{thought}</div>
                    </div>
                  )}

                  {/* Action details */}
                  {action.action && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs opacity-60 hover:opacity-100 font-medium mb-1">
                        View details
                      </summary>
                      <pre className="mt-2 text-xs font-mono bg-black/30 rounded p-3 overflow-x-auto">
                        {JSON.stringify(action.action, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          {/* Rejection reason input */}
          {showRejectInput && (
            <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-lg animate-slide-down">
              <label className="block text-sm font-medium mb-2">
                Reason for rejection (optional):
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)"
                rows={3}
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex items-center justify-between gap-3">
          <div className="text-xs opacity-60">
            {pendingActions.some((a) => a.security_risk === 'HIGH') && (
              <div className="flex items-center gap-2 text-red-400">
                <span className="codicon codicon-warning" />
                <span>High-risk action detected</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {showRejectInput ? (
              <>
                <button
                  onClick={handleCancel}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm font-medium transition-colors border border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="codicon codicon-close mr-2" />
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-all hover:shadow-glow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="codicon codicon-check" />
                  Approve & Continue
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
