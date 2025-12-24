import type { UserRejectObservation } from '@openhands/agent-sdk-ts';
import { ERROR_ACCENT_COLOR, EventContainer, withAlpha } from './shared';

/** Renders user rejection of an agent action with optional reason. */
export function UserRejectBlock({ event, index }: { event: UserRejectObservation; index?: number }) {
  return (
    <EventContainer accentColor={ERROR_ACCENT_COLOR} bgOpacity={0.06} index={index}>
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(ERROR_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-close text-sm" style={{ color: ERROR_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Action Rejected</div>
      </div>
      <div className="text-sm">
        <span className="font-mono text-xs text-red-400/70 bg-red-500/10 px-2 py-0.5 rounded">{event.tool_name}</span>
        {event.rejection_reason && (
          <div className="mt-2 italic text-stone-300">{event.rejection_reason}</div>
        )}
      </div>
    </EventContainer>
  );
}

