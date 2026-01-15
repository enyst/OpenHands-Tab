import type { HalMode, HalStateSnapshot } from '../../../../shared/halTypes';

export type HalSettingsSnapshot = {
  enabled: boolean;
  mode: HalMode;
  userName: string;
  volume: number;
};

export const DEFAULT_HAL_SETTINGS: HalSettingsSnapshot = { enabled: false, mode: 'tts_only', userName: 'Engel', volume: 1 };

export type HalUiState = Pick<HalStateSnapshot, 'phase' | 'eye' | 'stepIndex' | 'decision' | 'lastError'>;

export const DEFAULT_HAL_UI_STATE: HalUiState = {
  phase: 'idle',
  eye: 'off',
  stepIndex: null,
  decision: null,
  lastError: null,
};
