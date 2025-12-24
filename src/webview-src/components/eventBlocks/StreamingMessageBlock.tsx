import { AGENT_ACCENT_COLOR, withAlpha } from './shared';

/**
 * Renders live streaming content while agent is generating response.
 * Shows animated cursor and "streaming..." indicator.
 */
export function StreamingMessageBlock({ content }: { content: string }) {
  const accentColor = AGENT_ACCENT_COLOR;

  return (
    <div
      className="relative rounded-xl p-4 my-3 shadow-event border-l-[3px] border-r border-t border-b border-r-white/[0.04] border-t-white/[0.04] border-b-white/[0.02] transition-all duration-200"
      style={{
        borderLeftColor: accentColor,
        background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 6%, transparent) 0%, color-mix(in srgb, ${accentColor} 3%, transparent) 100%)`,
      }}
    >
      {/* Subtle top highlight */}
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-xl"
        style={{ background: `linear-gradient(90deg, ${withAlpha(accentColor, 12)}, transparent 50%)` }}
      />

      <div className="flex items-start gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 flex-shrink-0 animate-pulse-glow"
          style={{ backgroundColor: withAlpha(accentColor, 10) }}
        >
          <span className="codicon codicon-hubot text-sm" style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold text-sm text-amber-200">OpenHands says</div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: accentColor }}
              />
              <span className="text-xs text-stone-500">streaming...</span>
            </div>
          </div>

          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-stone-200">
            {content}
            <span
              className="inline-block w-0.5 h-4 ml-0.5 rounded-sm animate-pulse"
              style={{ backgroundColor: accentColor }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

