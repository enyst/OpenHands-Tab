import * as vscode from 'vscode';
import type { Event, MessageEvent } from '@openhands/agent-sdk-ts';
import { isTextContent } from '@openhands/agent-sdk-ts';
import { getPastedImagePath, rewriteOpenHandsImageUrls } from '../../shared/pastedImages';
import { summarizeAgentErrorEvent, summarizeConversationErrorEvent } from '../../shared/errorSummaries';

export function transformEventForWebview(
  event: Event,
  params: { webview: vscode.Webview; pastedImagesBaseDir: string }
): Event {
  if (event.kind === 'AgentErrorEvent') return summarizeAgentErrorEvent(event);
  if (event.kind === 'ConversationErrorEvent') return summarizeConversationErrorEvent(event);
  if (event.kind !== 'MessageEvent') return event;
  const msgEvent: MessageEvent = event;
  const msg = msgEvent.llm_message;
  if (!msg || !Array.isArray(msg.content)) return event;

  let changed = false;
  const content = msg.content.map((part) => {
    if (!isTextContent(part)) return part;

    const nextText = rewriteOpenHandsImageUrls(part.text, (imageId) => {
      try {
        const filePath = getPastedImagePath(params.pastedImagesBaseDir, imageId);
        return params.webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      } catch {
        return undefined;
      }
    });

    if (nextText === part.text) return part;
    changed = true;
    return { ...part, text: nextText };
  });

  if (!changed) return event;
  return {
    ...msgEvent,
    llm_message: {
      ...msg,
      content,
    },
  };
}
