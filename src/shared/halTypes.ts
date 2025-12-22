export const HAL_PHASES = [
  'idle',
  'dialogue',
  'awaiting_user',
  'listening',
  'classifying',
  'waiting_remote',
  'error',
] as const;

export type HalPhase = (typeof HAL_PHASES)[number];

export const HAL_EYES = ['off', 'dim', 'pulsating'] as const;
export type HalEye = (typeof HAL_EYES)[number];

export const HAL_DECISIONS = ['approve_local', 'teleport_remote', 'reject'] as const;
export type HalDecision = (typeof HAL_DECISIONS)[number];

export const ELEVENLABS_MODES = ['bundled', 'tts_only', 'voice_confirm'] as const;
export type ElevenLabsMode = (typeof ELEVENLABS_MODES)[number];

export type HalStateSnapshot = {
  enabled: boolean;
  mode: ElevenLabsMode;
  phase: HalPhase;
  eye: HalEye;
  stepIndex: number | null;
  decision: HalDecision | null;
  lastError: string | null;
};

export const isElevenLabsMode = (value: unknown): value is ElevenLabsMode =>
  typeof value === 'string' && (ELEVENLABS_MODES as readonly string[]).includes(value);

export const isHalPhase = (value: unknown): value is HalPhase =>
  typeof value === 'string' && (HAL_PHASES as readonly string[]).includes(value);

export const isHalEye = (value: unknown): value is HalEye =>
  typeof value === 'string' && (HAL_EYES as readonly string[]).includes(value);

export const isHalDecision = (value: unknown): value is HalDecision =>
  typeof value === 'string' && (HAL_DECISIONS as readonly string[]).includes(value);

