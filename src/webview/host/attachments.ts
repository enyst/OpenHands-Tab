import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
import { MAX_PASTED_IMAGE_BYTES, MAX_PASTED_IMAGES } from '../../shared/pasteLimits';

const MAX_ATTACHMENT_BYTES_PER_FILE = 200 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 500 * 1024;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function isProbablyBinary(bytes: Uint8Array): boolean {
  // Heuristic: treat NUL bytes as binary.
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function escapeMarkdownAltText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/[\r\n]+/g, ' ').trim();
}

export function toAttachmentLabel(uri: vscode.Uri): string {
  try {
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (rel && rel !== uri.fsPath) return rel;
  } catch (err) {
    console.warn('[OpenHands] Failed to compute relative attachment label', err);
  }
  return path.basename(uri.fsPath);
}

export function safeParseUri(raw: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(raw, true);
  } catch (err) {
    console.warn('[OpenHands] Skipping invalid URI', err);
    return undefined;
  }
}

export async function buildAttachmentBlocks(attachmentUris: vscode.Uri[]): Promise<string> {
  if (attachmentUris.length === 0) return '';

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const blocks: string[] = [];
  let totalIncluded = 0;
  let imageCount = 0;

  for (const uri of attachmentUris) {
    const label = toAttachmentLabel(uri);
    const begin = `----- BEGIN ATTACHMENT: ${label} -----`;
    const end = `----- END ATTACHMENT: ${label} -----`;

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);

      const ext = path.extname(uri.fsPath ?? '').toLowerCase();
      const mime = IMAGE_EXT_TO_MIME[ext];
      if (mime) {
        if (imageCount >= MAX_PASTED_IMAGES) {
          blocks.push(`\n\n${begin}\n(attachment skipped: too many images; max ${MAX_PASTED_IMAGES} images)\n${end}`);
          continue;
        }
        if (bytes.length > MAX_PASTED_IMAGE_BYTES) {
          const mb = MAX_PASTED_IMAGE_BYTES / (1024 * 1024);
          blocks.push(`\n\n${begin}\n(attachment skipped: image too large; max ${mb}MB)\n${end}`);
          continue;
        }

        imageCount += 1;
        const base64 = Buffer.from(bytes).toString('base64');
        const alt = escapeMarkdownAltText(label);
        blocks.push(`\n\n${begin}\n![${alt}](data:${mime};base64,${base64})\n${end}`);
        continue;
      }

      if (isProbablyBinary(bytes)) {
        blocks.push(`\n\n${begin}\n(attachment skipped: binary file)\n${end}`);
        continue;
      }

      const remaining = MAX_ATTACHMENT_TOTAL_BYTES - totalIncluded;
      if (remaining <= 0) {
        blocks.push(`\n\n${begin}\n(attachment skipped: total attachment size limit reached)\n${end}`);
        continue;
      }

      const maxForThis = Math.min(MAX_ATTACHMENT_BYTES_PER_FILE, remaining);
      const truncated = bytes.length > maxForThis;
      const slice = bytes.slice(0, maxForThis);
      totalIncluded += slice.length;

      const meta = truncated ? `(truncated: first ${slice.length} bytes of ${bytes.length} bytes)\n` : '';
      const content = decoder.decode(slice);
      blocks.push(`\n\n${begin}\n${meta}${content}\n${end}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      blocks.push(`\n\n${begin}\n(attachment skipped: ${reason})\n${end}`);
    }
  }

  return blocks.join('');
}
