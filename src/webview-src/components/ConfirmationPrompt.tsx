import { useState } from 'react';
import type { ActionEvent } from '@smolpaws/agent-sdk';
import { SecurityRiskBadge } from './SecurityRiskBadge';

interface ConfirmationPromptProps {
  pendingActions: ActionEvent[];
  onApprove: () => void;
  onReject: (reason?: string) => void;
  onOpenPath?: (path: string) => void;
  isSubmitting?: boolean;
}

export function ConfirmationPrompt({
  pendingActions,
  onApprove,
  onReject,
  onOpenPath,
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

  const getFileAccessSummary = (action: ActionEvent): { operation: 'read' | 'write'; path: string } | undefined => {
    if (action.tool_name !== 'file_editor') return undefined;
    const record = action.action;
    const command = typeof record?.command === 'string' ? record.command : undefined;
    const p = typeof record?.path === 'string' ? record.path : undefined;
    if (!command || !p) return undefined;
    const operation: 'read' | 'write' = command === 'view' ? 'read' : 'write';
    return { operation, path: p };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      data-testid="confirmation-prompt"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden="true" />

      {/* Modal */}
      <div
        className="relative max-w-2xl w-full max-h-[80vh] overflow-hidden rounded-2xl shadow-2xl animate-scale-in border border-white/[0.08]"
        style={{
          background: 'linear-gradient(135deg, rgba(28, 25, 23, 0.98) 0%, rgba(12, 10, 9, 0.98) 100%)',
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] bg-gradient-to-r from-brand-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center animate-pulse-glow border border-brand-500/20">
              <span className="codicon codicon-shield text-xl text-brand-400" />
            </div>
            <div>
              <h2 id="confirmation-title" className="text-lg font-semibold text-stone-100">Confirmation Required</h2>
              <p className="text-xs text-stone-500 mt-0.5">
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
              const fileAccess = getFileAccessSummary(action);

              return (
                <div
                  key={action.tool_call_id || index}
                  className={`
                    p-4 rounded-xl border
                    ${hasHighRisk
                      ? 'bg-red-500/[0.08] border-red-500/25'
                      : 'bg-white/[0.03] border-white/[0.06]'
                    }
                  `}
                >
                  {/* Action header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center">
                        <span className="codicon codicon-play text-sm text-teal-400" />
                      </div>
                      <span className="font-mono text-sm text-teal-300">{action.tool_name}</span>
                    </div>
                    {action.security_risk && action.security_risk !== 'UNKNOWN' && (
                      <SecurityRiskBadge risk={action.security_risk} labelSuffix=" risk" />
                    )}
                  </div>

                  {/* Thought process */}
                  {thought && (
                    <div className="mb-3 text-sm leading-relaxed">
                      <div className="font-medium text-xs uppercase tracking-wider text-stone-500 mb-1.5">
                        Reasoning
                      </div>
                      <div className="italic text-stone-300">{thought}</div>
                    </div>
                  )}

                  {/* File access summary */}
                  {fileAccess && (
                    <div className="mb-3 text-sm leading-relaxed">
                      <div className="font-medium text-xs uppercase tracking-wider text-stone-500 mb-1.5">
                        File Access
                      </div>
                      <div className="flex items-start gap-2">
                        <span
                          className={`
                            inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border
                            ${fileAccess.operation === 'write'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
                              : 'bg-teal-500/15 text-teal-300 border-teal-400/30'
                            }
                          `}
                        >
                          {fileAccess.operation.toUpperCase()}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenPath?.(fileAccess.path)}
                          className="text-xs font-mono text-stone-300 break-all underline decoration-stone-500/50 hover:text-stone-200 hover:decoration-stone-400 transition-colors text-left"
                        >
                          {fileAccess.path}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action details */}
                  {action.action && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-400 font-medium mb-1 transition-colors">
                        View details
                      </summary>
                      <pre className="mt-2 text-xs font-mono bg-black/30 border border-white/[0.04] rounded-lg p-3 overflow-x-auto text-stone-400">
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
            <div className="mt-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl animate-slide-down">
              <label htmlFor="reject-reason" className="block text-sm font-medium text-stone-300 mb-2">
                Reason for rejection (optional):
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)"
                rows={3}
                className="w-full px-3 py-2 bg-black/30 border border-white/[0.08] rounded-lg text-sm text-stone-200 placeholder:text-stone-500 resize-none focus:outline-none focus:ring-0 focus:border-white/[0.08] focus:shadow-[0_0_0_1px_rgba(232,166,66,0.08)]"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.06] bg-white/[0.02] flex items-center justify-between gap-3">
          <div className="text-xs">
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
                  className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:bg-white/[0.08] hover:text-stone-300 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm font-medium transition-all border border-red-400/30 disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
                >
                  Confirm Rejection
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-stone-400 hover:bg-white/[0.08] hover:text-stone-300 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 oh-focus-outline"
                >
                  <span className="codicon codicon-close" />
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 text-white text-sm font-medium transition-all shadow-glow-sm hover:from-brand-400 hover:to-brand-500 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed oh-focus-outline"
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
