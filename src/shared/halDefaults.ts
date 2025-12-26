import type { HalStateSnapshot } from './halTypes';

export const DEFAULT_HAL_STATE: HalStateSnapshot = {
  enabled: false,
  mode: 'tts_only',
  phase: 'idle',
  eye: 'off',
  stepIndex: null,
  decision: null,
  lastError: null,
};

export const DEFAULT_HAL_LLM_PROFILE_ID = 'gemini-flash-hal';
