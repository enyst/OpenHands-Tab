import { useCallback, useState } from 'react';
import { isMessageEvent, type Event } from '@openhands/agent-sdk-ts';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { ShowStatusMessage } from './useStatusMessages';

type PostMessage = (msg: WebviewToHostMessage) => void;

export interface SkillItem {
  label: string;
  path: string;
}

export interface ToolItem {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

interface RenderedEvent {
  id: number;
  event: Event;
}

interface UseSkillsAndToolsArgs {
  events: RenderedEvent[];
  mode: 'local' | 'remote';
  postMessage: PostMessage;
  showStatusMessage: ShowStatusMessage;
}

/**
 * Manages skills/tools picker state so App.tsx can focus on wiring.
 */
export function useSkillsAndTools({ events, mode, postMessage, showStatusMessage }: UseSkillsAndToolsArgs) {
  const [showSkillsPopover, setShowSkillsPopover] = useState(false);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showToolsPopover, setShowToolsPopover] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [enabledToolIds, setEnabledToolIds] = useState<string[]>([]);

  const handleOpenSkills = useCallback(() => {
    setShowToolsPopover(false);
    setShowSkillsPopover((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestSkills' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  const handleOpenSkill = useCallback((path: string) => {
    showStatusMessage('info', 'Opening skill…');
    postMessage({ type: 'openSkill', path });
    setShowSkillsPopover(false);
  }, [postMessage, showStatusMessage]);

  const isToolSelectionLocked = events.some((ev) => isMessageEvent(ev.event) && ev.event.source === 'user');

  const handleOpenTools = useCallback(() => {
    setShowSkillsPopover(false);
    setShowToolsPopover((prev) => {
      const willBeOpen = !prev;
      if (willBeOpen) {
        postMessage({ type: 'requestTools' });
      }
      return willBeOpen;
    });
  }, [postMessage]);

  const handleToggleTool = useCallback((toolId: string) => {
    if (mode !== 'local') {
      showStatusMessage('info', 'Tools are controlled by the agent-server in remote mode.', { autoDismiss: true, autoDismissDelay: 4000 });
      return;
    }

    if (isToolSelectionLocked) {
      showStatusMessage('info', 'To change Tools, please start a new conversation.', { autoDismiss: true, autoDismissDelay: 4000 });
      return;
    }

    if (toolId === 'finish') {
      showStatusMessage('info', 'Finish is always enabled.', { autoDismiss: true, autoDismissDelay: 2500 });
      return;
    }

    setEnabledToolIds((prev) => {
      const known = new Set(tools.map((tool) => tool.id));
      if (!known.has(toolId)) return prev;

      const nextSet = new Set(prev);
      if (nextSet.has(toolId)) nextSet.delete(toolId);
      else nextSet.add(toolId);

      const ordered = tools.map((tool) => tool.id).filter((id) => nextSet.has(id));
      postMessage({ type: 'setEnabledTools', toolIds: ordered });
      return ordered;
    });
  }, [isToolSelectionLocked, mode, postMessage, showStatusMessage, tools]);

  return {
    showSkillsPopover,
    setShowSkillsPopover,
    skills,
    setSkills,
    showToolsPopover,
    setShowToolsPopover,
    tools,
    setTools,
    enabledToolIds,
    setEnabledToolIds,
    handleOpenSkills,
    handleOpenSkill,
    handleOpenTools,
    handleToggleTool,
  };
}
