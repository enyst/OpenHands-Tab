import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

export const OPENHANDS_IMAGE_URL_PREFIX = 'openhands-image://';

export const PASTED_IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const PASTED_IMAGE_ALLOWED_EXTENSIONS = new Set(Object.values(PASTED_IMAGE_MIME_TO_EXT));

export function getGlobalStorageBaseDir(globalStorageFsPath?: string): string {
  return globalStorageFsPath || path.join(os.tmpdir(), 'oh-tab-global-storage');
}

export function getPastedImagesDir(baseDir: string): string {
  return path.join(baseDir, 'pasted-images');
}

export function isValidPastedImageId(imageId: string): boolean {
  const match = /^([a-f0-9]{16})\.([a-z0-9]+)$/.exec(imageId);
  if (!match) return false;
  const ext = match[2];
  return PASTED_IMAGE_ALLOWED_EXTENSIONS.has(ext);
}

export function getPastedImagePath(baseDir: string, imageId: string): string {
  if (!isValidPastedImageId(imageId)) {
    throw new Error(`Invalid pasted image id: ${imageId}`);
  }
  return path.join(getPastedImagesDir(baseDir), imageId);
}

export function parseBase64DataImageUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array; imageId: string } | undefined {
  const raw = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match) return undefined;

  const mimeType = match[1].toLowerCase();
  const ext = PASTED_IMAGE_MIME_TO_EXT[mimeType];
  if (!ext) return undefined;

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(match[2], 'base64'));
  } catch {
    return undefined;
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const imageId = `${hash}.${ext}`;
  return { mimeType, bytes, imageId };
}

export function rewriteDataImageMarkdown(
  text: string,
  rewrite: (dataUrl: string) => { url: string } | undefined
): { text: string; rewritten: number } {
  const raw = typeof text === 'string' ? text : '';
  const imageRegex = /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g;

  let rewritten = 0;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(raw)) !== null) {
    const start = match.index;
    const full = match[0];
    const alt = match[1] ?? '';
    const dataUrl = match[2] ?? '';
    const replacement = rewrite(dataUrl);
    if (!replacement) continue;

    out += raw.slice(last, start);
    out += `![${alt}](${replacement.url})`;
    last = start + full.length;
    rewritten += 1;
  }

  if (rewritten === 0) return { text: raw, rewritten: 0 };
  out += raw.slice(last);
  return { text: out, rewritten };
}

export function rewriteOpenHandsImageUrls(
  text: string,
  resolve: (imageId: string) => string | undefined
): string {
  const raw = typeof text === 'string' ? text : '';
  return raw.replaceAll(new RegExp(`${OPENHANDS_IMAGE_URL_PREFIX}([a-f0-9]{16}\\.[a-z0-9]+)`, 'g'), (full, imageId: string) => {
    const replacement = resolve(imageId);
    return replacement ?? full;
  });
}

