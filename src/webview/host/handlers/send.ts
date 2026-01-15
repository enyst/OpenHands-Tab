import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConversationInstance } from '@openhands/agent-sdk-ts';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import { OPENHANDS_IMAGE_URL_PREFIX, getGlobalStorageBaseDir, getPastedImagePath, parseBase64DataImageUrl, rewriteDataImageMarkdown, rewriteOpenHandsImageUrls } from '../../../shared/pastedImages';
import { MAX_PASTED_IMAGE_BYTES } from '../../../shared/pasteLimits';
import { buildAttachmentBlocks, safeParseUri } from '../attachments';
import type { CreateWebviewMessageHandlerDeps } from '../createWebviewMessageHandler';

async function persistPastedImage(baseDir: string, imageId: string, bytes: Uint8Array): Promise<void> {
  const filePath = getPastedImagePath(baseDir, imageId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

export async function handleSend(args: {
  context: vscode.ExtensionContext;
  deps: CreateWebviewMessageHandlerDeps;
  conversation: ConversationInstance;
  message: Extract<WebviewToHostMessage, { type: 'send' }>;
  outputChannel: vscode.OutputChannel | undefined;
}): Promise<void> {
  const baseText = args.message.text;
  const contextFiles = Array.isArray(args.message.contextFiles)
    ? args.message.contextFiles.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : [];
  const attachmentUris = Array.isArray(args.message.attachments)
    ? args.message.attachments
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((u) => safeParseUri(u))
      .filter((u): u is vscode.Uri => u !== undefined)
    : [];

  const globalStorageBaseDir = getGlobalStorageBaseDir(args.context.globalStorageUri?.fsPath);
  const pastedImages = new Map<string, Uint8Array>();
  const rewriteResult = rewriteDataImageMarkdown(baseText, (dataUrl) => {
    const parsed = parseBase64DataImageUrl(dataUrl);
    if (!parsed) return { url: '' };
    if (parsed.bytes.length > MAX_PASTED_IMAGE_BYTES) return { url: '' };
    pastedImages.set(parsed.imageId, parsed.bytes);
    return { url: `${OPENHANDS_IMAGE_URL_PREFIX}${parsed.imageId}` };
  });

  let sanitizedText = rewriteResult.text;
  if (pastedImages.size > 0) {
    const failed = new Set<string>();
    for (const [imageId, bytes] of pastedImages.entries()) {
      try {
        await persistPastedImage(globalStorageBaseDir, imageId, bytes);
      } catch (err) {
        failed.add(imageId);
        const reason = err instanceof Error ? err.message : String(err);
        args.outputChannel?.appendLine(`[pasted-images] Failed to persist ${imageId}: ${reason}`);
      }
    }
    if (failed.size > 0) {
      sanitizedText = rewriteOpenHandsImageUrls(sanitizedText, (imageId) => (failed.has(imageId) ? '' : undefined));
      void vscode.window.showWarningMessage(`Some pasted images could not be saved (${failed.size}). They were omitted from the message.`);
    }
  } else if (rewriteResult.rewritten > 0) {
    void vscode.window.showWarningMessage('Some pasted images were not supported and were omitted from the message.');
  }

  const attachmentsText = await buildAttachmentBlocks(attachmentUris);

  let finalText = sanitizedText;
  if (attachmentsText) {
    finalText += attachmentsText;
  }
  if (contextFiles.length > 0) {
    finalText += `\n\nUser has selected the following files for you to read:\n${contextFiles.join('\n')}`;
  }

  const queuedNotes = args.deps.getQueuedUserEditNotes();
  const queuedNotesText = queuedNotes
    .filter((note) => typeof note === 'string' && note.trim().length > 0)
    .map((note) => note.trimEnd())
    .join('\n\n');

  if (queuedNotesText) {
    await args.conversation.sendUserMessage(finalText, { extendedContent: [{ type: 'text', text: queuedNotesText }] });
    args.deps.clearQueuedUserEditNotes();
  } else {
    await args.conversation.sendUserMessage(finalText);
  }
}
