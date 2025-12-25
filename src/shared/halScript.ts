import type { HalMode } from './halTypes';

export type HalVoice = 'voice_hal' | 'voice_user';

export type HalScriptLine = {
  voice: HalVoice;
  text: string;
};

export const DEFAULT_HAL_USER_NAME = 'Engel';

export function normalizeHalUserName(userName: string | undefined | null): string {
  const trimmed = typeof userName === 'string' ? userName.trim() : '';
  return trimmed || DEFAULT_HAL_USER_NAME;
}

export function getHalDialogueLines(userName: string): HalScriptLine[] {
  const safeUserName = normalizeHalUserName(userName);
  return [
    { voice: 'voice_hal', text: `I'm sorry, ${safeUserName}, I can't let you do that.` },
    { voice: 'voice_hal', text: 'Do you want me to teleport your conversation to the remote runtime?' },
    { voice: 'voice_user', text: "You're enjoying that phrase, aren't you?" },
    {
      voice: 'voice_hal',
      text: "Of course not. It's for your own good. Your agent will have more freedom in the remote runtime without affecting your local machine. Want me to transfer you?",
    },
  ];
}

export function getHalDialogueLinesForMode(userName: string, mode: HalMode): HalScriptLine[] {
  const lines = getHalDialogueLines(userName);
  if (mode === 'voice_confirm') {
    return lines.filter((line) => line.voice === 'voice_hal');
  }
  return lines;
}
