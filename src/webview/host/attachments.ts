import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';

const MAX_ATTACHMENT_BYTES_PER_FILE = 200 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 500 * 1024;

function isProbablyBinary(bytes: Uint8Array): boolean {
  // Heuristic: treat NUL bytes as binary.
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
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

  for (const uri of attachmentUris) {
    const label = toAttachmentLabel(uri);
    const begin = `----- BEGIN ATTACHMENT: ${label} -----`;
    const end = `----- END ATTACHMENT: ${label} -----`;

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);

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

