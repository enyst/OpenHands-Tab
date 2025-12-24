import { useState } from 'react';
import type { SystemPromptEvent } from '@openhands/agent-sdk-ts';
import { EventContainer, SYSTEM_ACCENT_COLOR, withAlpha } from './shared';

/**
 * Renders system prompt - expandable view of initial agent instructions.
 */
export function SystemPromptEventBlock({ event, index }: { event: SystemPromptEvent; index?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleLabel = isExpanded ? 'Hide system prompt' : 'Show system prompt';

  return (
    <EventContainer accentColor={SYSTEM_ACCENT_COLOR} bgOpacity={0.03} index={index}>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: withAlpha(SYSTEM_ACCENT_COLOR, 9) }}
        >
          <span className="codicon codicon-gear text-sm" style={{ color: SYSTEM_ACCENT_COLOR }} />
        </div>
        <div className="font-semibold text-sm text-stone-200">System Prompt</div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.05]"
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
          <span>{isExpanded ? 'Hide' : 'Show'}</span>
        </button>
      </div>
      {isExpanded && (
        <>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300 font-mono bg-black/20 rounded-lg p-3 border border-white/[0.04]">
            {event.system_prompt.text}
          </div>
          {event.tools && event.tools.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-stone-400 flex items-center gap-2">
              <span className="codicon codicon-tools" style={{ color: SYSTEM_ACCENT_COLOR }} />
              <span>{event.tools.length} tools available</span>
            </div>
          )}
        </>
      )}
    </EventContainer>
  );
}

