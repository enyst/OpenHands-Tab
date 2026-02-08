import { MAX_OUTPUT_CHARS, OUTPUT_CLIP_MARKER } from './shared';

export const applyViewRange = (content: string, viewRange?: number[]): string => {
  if (!viewRange || viewRange.length !== 2) return content;
  const [start, end] = viewRange;
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(start - 1, end === -1 ? undefined : end);
  return slice.join('\n');
};

export const addLineNumbers = (content: string): string => {
  const lines = content.split(/\r?\n/);
  return lines.map((line, idx) => `${idx + 1}\t${line}`).join('\n');
};

export const truncateContent = (content: string, maxChars = MAX_OUTPUT_CHARS): string => {
  if (content.length <= maxChars) return content;
  const minRequired = OUTPUT_CLIP_MARKER.length + 2;
  if (maxChars < minRequired) {
    return content.slice(0, maxChars);
  }
  const available = maxChars - OUTPUT_CLIP_MARKER.length - 2;
  const half = Math.max(0, Math.floor(available / 2));
  const head = content.slice(0, half);
  const tail = content.slice(content.length - half);
  return `${head}\n${OUTPUT_CLIP_MARKER}\n${tail}`;
};

export const isProbablyBinary = (buffer: Buffer): boolean => {
  if (buffer.length === 0) return false;
  const sampleSize = Math.min(buffer.length, 8000);
  let suspiciousBytes = 0;
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
    // Count control chars excluding common whitespace (\t \n \r).
    if ((byte < 7 || (byte > 13 && byte < 32) || byte === 127) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes++;
    }
  }
  return suspiciousBytes / sampleSize > 0.3;
};
