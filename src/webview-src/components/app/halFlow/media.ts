const DEFAULT_BUNDLED_AUDIO_EXTENSION = 'wav';

function getOpenHandsMediaBaseUri(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="openhands-media-base"]');
  if (!meta) return null;
  const content = (meta as HTMLMetaElement).content?.trim() ?? '';
  return content || null;
}

function buildMediaUrl(relativePath: string): string | null {
  const base = getOpenHandsMediaBaseUri();
  if (!base) return null;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const rel = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}${rel}`;
}

export function getBundledHalSceneUrl(): string | null {
  return buildMediaUrl(`hal/bundled/scene.${DEFAULT_BUNDLED_AUDIO_EXTENSION}`);
}

export function getBundledHalMusicStingUrl(): string | null {
  return buildMediaUrl(`hal/bundled/music_sting.${DEFAULT_BUNDLED_AUDIO_EXTENSION}`);
}

export function describeHalAudioPlaybackFailure(error: unknown): { message: string; debug: string } {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return {
        message: 'HAL audio was blocked by autoplay policy. Click anywhere in this dialog (or any button) to play the audio.',
        debug: `${error.name}: ${error.message || '(no message)'}`,
      };
    }
    return {
      message: `HAL audio failed to play (${error.name}).`,
      debug: `${error.name}: ${error.message || '(no message)'}`,
    };
  }

  if (error instanceof Error) {
    const name = error.name || 'Error';
    const message = error.message || '(no message)';
    if (name === 'NotAllowedError' || /notallowederror/i.test(`${name}: ${message}`)) {
      return {
        message: 'HAL audio was blocked by autoplay policy. Click anywhere in this dialog (or any button) to play the audio.',
        debug: `${name}: ${message}`,
      };
    }
    return { message: 'HAL audio failed to play (bundled clip).', debug: `${name}: ${message}` };
  }

  if (typeof error === 'string' && error.trim()) {
    return { message: 'HAL audio failed to play (bundled clip).', debug: error.trim() };
  }

  return { message: 'HAL audio failed to play (bundled clip).', debug: String(error) };
}

export function isAutoplayBlockedError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'NotAllowedError';
  if (error instanceof Error) return error.name === 'NotAllowedError' || /notallowederror/i.test(`${error.name}: ${error.message}`);
  if (typeof error === 'string') return /notallowederror/i.test(error) || /autoplay/i.test(error);
  return false;
}

