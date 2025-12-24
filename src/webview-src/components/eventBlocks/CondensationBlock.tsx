import type { Condensation } from '@openhands/agent-sdk-ts';
import { EventContainer, SYSTEM_ACCENT_COLOR, withAlpha } from './shared';

/** Renders condensation event when conversation history is summarized. */
export function CondensationBlock({ event, index }: { event: Condensation; index?: number }) {
  return (
    <EventContainer accentColor={SYSTEM_ACCENT_COLOR} bgOpacity={0.03} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(SYSTEM_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-archive text-sm" style={{ color: SYSTEM_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">Conversation Summarized</div>
      </div>
      <div className="text-sm">
        <div className="mb-2 text-stone-400">
          Forgetting {event.forgotten_event_ids.length} events
        </div>
        {event.summary && (
          <div className="bg-black/20 border border-white/[0.04] rounded-lg p-3 leading-relaxed italic text-stone-300">
            {event.summary}
          </div>
        )}
      </div>
    </EventContainer>
  );
}

