import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { WebviewToHostMessage } from '../../../shared/webviewMessages';
import type { WebviewHost, CreateWebviewMessageHandlerDeps } from '../createWebviewMessageHandler';
import { getConversationHistoryList, persistConversationTitle } from '../conversationHistory';
import { summarizeWithLocalLlm } from '../../../extension/summarizeWithLocalLlm';
import type { OpenHandsSettings } from '../../../settings/SettingsManager';

function normalizeGeneratedConversationTitle(raw: string): string | undefined {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;

  const unquoted = firstLine.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  if (!unquoted) return undefined;

  const strippedPrefix = unquoted.replace(/^title\\s*:\\s*/i, '').trim();
  if (!strippedPrefix) return undefined;

  const words = strippedPrefix.split(/\\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  return words.slice(0, 7).join(' ');
}

export async function handleRequestHistory(args: {
  deps: CreateWebviewMessageHandlerDeps;
  host: WebviewHost;
  settingsMgr: { get: () => Promise<OpenHandsSettings> };
  outputChannel: vscode.OutputChannel | undefined;
  historyTitleGenerationInFlight: Set<string>;
}): Promise<void> {
  try {
    const convRoot = args.deps.getConversationStoreRoot() ?? (await args.deps.resolveConversationStoreRoot());
    const conversations = await getConversationHistoryList(convRoot, args.outputChannel);
    void args.host.postMessage({ type: 'historyList', conversations });

    // Best-effort: generate short titles for items that don't have one persisted yet.
    // Non-blocking: HistoryView should render immediately and then update as titles become available.
    void (async () => {
      const secrets = args.deps.secretRegistry;
      if (!secrets) return;

      const missing = conversations
        .filter((c) => !c.title && typeof c.firstMessage === 'string' && c.firstMessage.trim().length > 0)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 30);
      if (missing.length === 0) return;

      const settings = await args.settingsMgr.get();

      for (const convo of missing) {
        if (args.historyTitleGenerationInFlight.has(convo.id)) continue;
        args.historyTitleGenerationInFlight.add(convo.id);
        try {
          const prompt =
            `Generate a short conversation title (max 7 words).\\n` +
            `Return ONLY the title text (no quotes, no punctuation at the end).\\n\\n` +
            `First user message:\\n${convo.firstMessage}`;

          const raw = await summarizeWithLocalLlm(settings, prompt, secrets);
          const title = normalizeGeneratedConversationTitle(raw);
          if (!title) continue;

          await persistConversationTitle(convRoot, convo.id, title, args.outputChannel);
          convo.title = title;
          void args.host.postMessage({ type: 'historyList', conversations });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          args.outputChannel?.appendLine(`[history] Failed to generate title for ${convo.id}: ${reason}`);
          // If this fails once (missing key/profile/etc.), avoid spamming more calls this round.
          break;
        } finally {
          args.historyTitleGenerationInFlight.delete(convo.id);
        }
      }
    })();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine(`[history] ${reason}`);
    void args.host.postMessage({ type: 'historyList', conversations: [] });
  }
}

export async function handleDeleteConversation(args: {
  deps: CreateWebviewMessageHandlerDeps;
  outputChannel: vscode.OutputChannel | undefined;
  conversation: unknown;
  message: Extract<WebviewToHostMessage, { type: 'deleteConversation' }>;
}): Promise<void> {
  const id = args.message.id;
  if (!id) return;
  const activeConversationId = (args.conversation as { getConversationId?: () => string } | undefined)?.getConversationId?.();
  if (activeConversationId && activeConversationId === id) {
    void vscode.window.showWarningMessage('Cannot delete the active conversation.');
    return;
  }
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Invalid conversation id');
    }
    const convRoot = args.deps.getConversationStoreRoot() ?? (await args.deps.resolveConversationStoreRoot());
    const resolvedRoot = path.resolve(convRoot);
    const targetDir = path.resolve(convRoot, id);
    const relative = path.relative(resolvedRoot, targetDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid conversation id');
    }
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine(`[history] Failed to delete ${id}: ${reason}`);
    void vscode.window.showErrorMessage(`Failed to delete conversation: ${reason}`);
  }
}

export function handleRestoreConversation(args: {
  outputChannel: vscode.OutputChannel | undefined;
  conversation: unknown;
  message: Extract<WebviewToHostMessage, { type: 'restoreConversation' }>;
}): void {
  const id = args.message.id;
  if (!id) return;
  try {
    const maybe = (args.conversation as { restoreConversation?: (id: string) => unknown } | undefined)?.restoreConversation?.(id);
    void Promise.resolve(maybe).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      args.outputChannel?.appendLine(`[restore] ${reason}`);
      void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.outputChannel?.appendLine(`[restore] ${reason}`);
    void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
  }
}
