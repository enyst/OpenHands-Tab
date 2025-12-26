import { useState } from 'react';
import type { SystemPromptEvent } from '@openhands/agent-sdk-ts';
import { EventContainer, SYSTEM_ACCENT_COLOR, withAlpha } from './shared';
import { Tooltip } from '../Tooltip';

type LoadedSkill = { label: string; path: string };

const getNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getToolDisplayName = (tool: Record<string, unknown>, index: number): string => {
  const direct = getNonEmptyString(tool.name);
  if (direct) return direct;

  const functionField = tool.function;
  if (functionField && typeof functionField === 'object') {
    const name = getNonEmptyString((functionField as Record<string, unknown>).name);
    if (name) return name;
  }

  return `tool_${index + 1}`;
};

/**
 * Renders system prompt - expandable view of initial agent instructions.
 */
export function SystemPromptEventBlock({
  event,
  index,
  skills,
}: {
  event: SystemPromptEvent;
  index?: number;
  skills?: LoadedSkill[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const toggleLabel = isExpanded ? 'Hide system prompt' : 'Show system prompt';
  const toolNames = Array.isArray(event.tools)
    ? event.tools
      .filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === 'object')
      .map(getToolDisplayName)
    : [];

  const skillNames = Array.isArray(skills)
    ? skills
      .map((skill) => getNonEmptyString(skill.label))
      .filter((label): label is string => label !== null)
    : [];

  const idSuffix =
    typeof event.id === 'string' && event.id.trim().length > 0
      ? event.id.trim()
      : `idx-${index ?? 0}`;
  const skillsListId = `system-prompt-skills-${idSuffix}`;
  const toolsListId = `system-prompt-tools-${idSuffix}`;

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
        <Tooltip content={toggleLabel} position="left">
          <button
            onClick={() =>
              setIsExpanded((prev) => {
                const next = !prev;
                if (!next) {
                  setSkillsExpanded(false);
                  setToolsExpanded(false);
                }
                return next;
              })
            }
            className="ml-auto text-xs text-stone-400 hover:text-stone-300 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/[0.05]"
            aria-label={toggleLabel}
          >
            <span className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'} text-[10px]`} />
            <span>{isExpanded ? 'Hide' : 'Show'}</span>
          </button>
        </Tooltip>
      </div>
      {isExpanded && (
        <>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300 font-mono bg-black/20 rounded-lg p-3 border border-white/[0.04]">
            {event.system_prompt.text}
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-stone-400 space-y-2">
            <Tooltip content={skillsExpanded ? 'Hide skills' : 'Show skills'} position="top">
              <button
                type="button"
                onClick={() => setSkillsExpanded((prev) => !prev)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/[0.05] hover:text-stone-300 transition-colors"
                aria-label={`${skillNames.length} skills loaded`}
                aria-expanded={skillsExpanded}
                aria-controls={skillsListId}
              >
                <span className="codicon codicon-mortar-board" style={{ color: SYSTEM_ACCENT_COLOR }} />
                <span>{skillNames.length} skills loaded</span>
                <span className={`ml-auto codicon codicon-chevron-${skillsExpanded ? 'up' : 'down'} text-[10px] opacity-70`} />
              </button>
            </Tooltip>
            {skillsExpanded && (
              <div
                id={skillsListId}
                role="region"
                aria-label="Loaded skills"
                className="ml-7 bg-black/20 rounded-lg border border-white/[0.04] max-h-40 overflow-auto"
              >
                {skillNames.length > 0 ? (
                  skillNames.map((name, idx) => (
                    <div
                      key={`${name}:${idx}`}
                      className="px-3 py-1.5 text-xs text-stone-300 border-b border-white/[0.04] last:border-b-0"
                    >
                      {name}
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs opacity-70">No skills loaded</div>
                )}
              </div>
            )}

            <Tooltip content={toolsExpanded ? 'Hide tools' : 'Show tools'} position="top">
              <button
                type="button"
                onClick={() => setToolsExpanded((prev) => !prev)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/[0.05] hover:text-stone-300 transition-colors"
                aria-label={`${toolNames.length} tools available`}
                aria-expanded={toolsExpanded}
                aria-controls={toolsListId}
              >
                <span className="codicon codicon-tools" style={{ color: SYSTEM_ACCENT_COLOR }} />
                <span>{toolNames.length} tools available</span>
                <span className={`ml-auto codicon codicon-chevron-${toolsExpanded ? 'up' : 'down'} text-[10px] opacity-70`} />
              </button>
            </Tooltip>
            {toolsExpanded && (
              <div
                id={toolsListId}
                role="region"
                aria-label="Available tools"
                className="ml-7 bg-black/20 rounded-lg border border-white/[0.04] max-h-40 overflow-auto"
              >
                {toolNames.length > 0 ? (
                  toolNames.map((name, idx) => (
                    <div
                      key={`${name}:${idx}`}
                      className="px-3 py-1.5 text-xs text-stone-300 border-b border-white/[0.04] last:border-b-0"
                    >
                      {name}
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs opacity-70">No tools available</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </EventContainer>
  );
}
