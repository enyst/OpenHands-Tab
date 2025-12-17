import * as vscode from 'vscode';
import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { TextDecoder } from 'util';
import { FileStore } from '@openhands/agent-sdk-ts';
import { isEvent, isMessageEvent, isTextContent } from '@openhands/agent-sdk-ts';
import { SettingsManager, type SavedServer } from '../../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../../settings/VscodeSettingsAdapter';

export type WebviewHost = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

type WebviewMessage =
  | { type: 'webviewReady'; conversationId?: string; lastSeenSeq?: number }
  | { type: 'openSettingsPage' }
  | { type: 'openSettings' }
  | { type: 'requestWorkspaceFiles' }
  | { type: 'requestSkills' }
  | { type: 'openSkill'; path: string }
  | { type: 'openWorkspaceFile'; path: string }
  | { type: 'requestHistory' }
  | { type: 'restoreConversation'; id: string }
  | { type: 'getConfig' }
  | { type: 'selectServer'; url: string }
  | { type: 'addServer'; server: SavedServer }
  | { type: 'removeServer'; url: string }
  | { type: 'switchToLocal' }
  | { type: 'selectAttachments' }
  | { type: 'openAttachment'; uri: string }
  | { type: 'send'; text: string; contextFiles?: string[]; attachments?: string[] }
  | { type: 'command'; command: string; reason?: string }
  | {
    type: 'renderedEventsResponse';
    requestId: string;
    count: number;
    eventTypes: string[];
    events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
  }
  | {
    type: 'uiStateResponse';
    requestId: string;
    input: string;
    showContextPicker: boolean;
    showSkillsPopover: boolean;
    showHistory: boolean;
    workspaceFilesCount: number;
    selectedContextFiles: string[];
    skillsCount: number;
    attachmentsCount: number;
  }
  | { type: 'webviewConsole'; level: string; args: unknown[] }
  | { type: 'webviewError'; message: string; stack?: string }
  | { type: 'webviewNetwork'; phase: string; id: string; method: string; url: string; status?: number; ok?: boolean }
  | { type: 'webviewWebSocket'; phase: string; url: string; code?: number; reason?: string };

const MAX_ATTACHMENT_BYTES_PER_FILE = 200 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 500 * 1024;

function isProbablyBinary(bytes: Uint8Array): boolean {
  // Heuristic: treat NUL bytes as binary.
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function toAttachmentLabel(uri: vscode.Uri): string {
  try {
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (rel && rel !== uri.fsPath) return rel;
  } catch (err) {
    console.warn('[OpenHands] Failed to compute relative attachment label', err);
  }
  return path.basename(uri.fsPath);
}

function safeParseUri(raw: string): vscode.Uri | undefined {
  try {
    return vscode.Uri.parse(raw, true);
  } catch (err) {
    console.warn('[OpenHands] Skipping invalid URI', err);
    return undefined;
  }
}

async function buildAttachmentBlocks(attachmentUris: vscode.Uri[]): Promise<string> {
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

async function listWorkspaceFiles(limit = 500): Promise<string[]> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return [];
  }
  try {
    // Exclude common directories, build artifacts, and all dotfiles/dotdirs
    const excludePattern = '{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/coverage/**,**/tmp/**,**/temp/**,**/.*}';
    const uris = await vscode.workspace.findFiles('**/*', excludePattern, limit);
    const unique = new Set<string>();
    for (const uri of uris) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative) {
        unique.add(relative);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error('[OpenHands] Failed to list workspace files', err);
    return [];
  }
}

async function listSkillFiles(): Promise<{ label: string; path: string }[]> {
  const skillsDir = path.join(os.homedir(), '.openhands', 'skills');
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
    return files
      .map((entry) => {
        const absolutePath = path.join(skillsDir, entry.name);
        const label = entry.name.slice(0, -3); // remove .md
        return { label, path: absolutePath };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[OpenHands] Failed to read skills directory', err);
    }
    return [];
  }
}

const MAX_HISTORY_SCAN_BYTES = 512 * 1024;
const MAX_HISTORY_SCAN_LINES = 2000;

async function findFirstMessageEventLine(eventsPath: string): Promise<string | undefined> {
  const stream = nodeFs.createReadStream(eventsPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let scannedBytes = 0;
  let scannedLines = 0;

  try {
    for await (const line of rl) {
      scannedLines += 1;
      scannedBytes += Buffer.byteLength(line, 'utf8') + 1;

      if (line.includes('"MessageEvent"')) {
        return line;
      }

      if (scannedLines >= MAX_HISTORY_SCAN_LINES || scannedBytes >= MAX_HISTORY_SCAN_BYTES) {
        return undefined;
      }
    }

    return undefined;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export type CreateWebviewMessageHandlerDeps = {
  context: vscode.ExtensionContext;
  host: WebviewHost;

  getConversation: () => import('@openhands/agent-sdk-ts').ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
  getConversationStoreRoot: () => string | undefined;
  resolveConversationStoreRoot: () => Promise<string>;

  setWebviewReadyState: (conversationId?: string, lastSeenSeq?: number) => void;
  setLastKnownLlmModel: (model: string | null) => void;
  getLastKnownLlmModel: () => string | null;

  flushConversationEventBacklog: (args: {
    postMessage: WebviewHost['postMessage'];
    clientConversationId?: string;
    clientLastSeenSeq?: number;
  }) => void;

  onRenderedEventsResponse: (
    requestId: string,
    info: {
      count: number;
      eventTypes: string[];
      events?: Array<{ type: string; marker?: string; toolCallId?: string }>;
    }
  ) => void;
  onUiStateResponse: (
    requestId: string,
    info: {
      input: string;
      showContextPicker: boolean;
      showSkillsPopover: boolean;
      showHistory: boolean;
      workspaceFilesCount: number;
      selectedContextFiles: string[];
      skillsCount: number;
      attachmentsCount: number;
    }
  ) => void;

  isDevBridgeEnabled: () => boolean;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  fileLog: (line: string) => void;
};

export function createWebviewMessageHandler(deps: CreateWebviewMessageHandlerDeps) {
  const { context, host } = deps;
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));

  return async (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const message = msg as WebviewMessage;

    const outputChannel = deps.getOutputChannel();
    const conversation = deps.getConversation();

    switch (message.type) {
      case 'webviewReady': {
        deps.setWebviewReadyState(message.conversationId, message.lastSeenSeq);

        const initSettings = await settingsMgr.get();
        deps.setLastKnownLlmModel(initSettings.llm.model ?? null);

        void host.postMessage({
          type: 'status',
          status: conversation?.getStatus() ?? 'offline',
          mode: deps.getConversationMode(),
          llmModel: deps.getLastKnownLlmModel(),
        });

        void host.postMessage({
          type: 'serverListUpdated',
          servers: initSettings.servers,
          serverUrl: initSettings.serverUrl ?? '',
        });

        deps.flushConversationEventBacklog({
          postMessage: host.postMessage,
          clientConversationId: message.conversationId,
          clientLastSeenSeq: message.lastSeenSeq,
        });

        break;
      }
      case 'openSettingsPage':
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
        break;
      case 'requestWorkspaceFiles': {
        const files = await listWorkspaceFiles();
        void host.postMessage({ type: 'workspaceFiles', files });
        break;
      }
      case 'requestSkills': {
        const skills = await listSkillFiles();
        outputChannel?.appendLine(`[skills] Found ${skills.length} skill(s)`);
        void host.postMessage({ type: 'skillsList', skills });
        break;
      }
      case 'openSkill': {
        const skillPath = message.path;
        if (!skillPath) break;
        try {
          const skillsRoot = path.resolve(os.homedir(), '.openhands', 'skills');
          const resolvedPath = path.resolve(skillPath);
          const relative = path.relative(skillsRoot, resolvedPath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            void vscode.window.showErrorMessage('Refusing to open skill outside of ~/.openhands/skills');
            break;
          }
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open skill file: ${reason}`);
        }
        break;
      }
      case 'openWorkspaceFile': {
        const p = message.path;
        if (!p) break;
        try {
          const isAbs = path.isAbsolute(p);
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          let resolved: string | undefined;
          if (!isAbs && wsRoot) {
            const candidate = path.resolve(wsRoot, p);
            const rel = path.relative(wsRoot, candidate);
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
              resolved = candidate;
            }
          }
          if (!resolved) {
            resolved = path.resolve(p);
          }
          await fs.stat(resolved);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open file: ${reason}`);
        }
        break;
      }
      case 'requestHistory': {
        try {
          const convRoot = deps.getConversationStoreRoot() ?? (await deps.resolveConversationStoreRoot());
          let ids: string[] = [];
          try {
            ids = FileStore.listConversations(convRoot);
          } catch {
            ids = [];
          }
          const conversations = await Promise.all(
            ids.map(async (id) => {
              try {
                const statePath = path.join(convRoot, id, 'state.json');
                const eventsPath = path.join(convRoot, id, 'events.jsonl');
                const stat = await fs.stat(statePath).catch(async () => fs.stat(eventsPath));
                const timestamp = stat?.mtimeMs ?? Date.now();
                let firstMessage: string | undefined;
                try {
                  const line = await findFirstMessageEventLine(eventsPath);
                  if (line) {
                    try {
                      const parsed: unknown = JSON.parse(line);
                      if (isEvent(parsed) && isMessageEvent(parsed)) {
                        const msg = parsed.llm_message;
                        if (msg.role === 'user') {
                          const textPart = msg.content.find(isTextContent);
                          if (textPart) firstMessage = textPart.text;
                        }
                      }
                    } catch (err) {
                      const reason = err instanceof Error ? err.message : String(err);
                      outputChannel?.appendLine(`[history] Failed to parse MessageEvent for ${id}: ${reason}`);
                    }
                  }
                } catch (err) {
                  const code = (err as NodeJS.ErrnoException).code;
                  if (code !== 'ENOENT') {
                    const reason = err instanceof Error ? err.message : String(err);
                    outputChannel?.appendLine(`[history] Failed to scan events for ${id}: ${reason}`);
                  }
                }
                return { id, timestamp: Math.floor(timestamp), firstMessage };
              } catch {
                return { id, timestamp: Date.now() };
              }
            })
          );
          void host.postMessage({ type: 'historyList', conversations });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[history] ${reason}`);
          void host.postMessage({ type: 'historyList', conversations: [] });
        }
        break;
      }
      case 'restoreConversation': {
        const id = message.id;
        if (!id) break;
        try {
          const maybe = conversation?.restoreConversation?.(id);
          void Promise.resolve(maybe).catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            outputChannel?.appendLine(`[restore] ${reason}`);
            void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[restore] ${reason}`);
          void vscode.window.showErrorMessage(`Failed to restore conversation: ${reason}`);
        }
        break;
      }
      case 'getConfig': {
        const settings = await settingsMgr.get();
        void host.postMessage({ type: 'config', serverUrl: settings.serverUrl ?? null, mode: deps.getConversationMode() });
        break;
      }
      case 'selectServer': {
        const url = message.url;
        const currentSettings = await settingsMgr.get();

        const serverExists = currentSettings.servers.some((s) => s.url === url);
        if (!serverExists && url) {
          await settingsMgr.update({
            servers: [...currentSettings.servers, { url }],
            serverUrl: url,
          });
        } else {
          await settingsMgr.update({ serverUrl: url });
        }

        const updated = await settingsMgr.get();
        void host.postMessage({
          type: 'serverListUpdated',
          servers: updated.servers,
          serverUrl: updated.serverUrl ?? '',
        });
        break;
      }
      case 'addServer': {
        const server = message.server;
        if (!server?.url) break;

        const currentSettings = await settingsMgr.get();
        const exists = currentSettings.servers.some((s) => s.url === server.url);
        if (!exists) {
          const newServers = [...currentSettings.servers, server];
          await settingsMgr.update({ servers: newServers });
          void host.postMessage({
            type: 'serverListUpdated',
            servers: newServers,
            serverUrl: currentSettings.serverUrl ?? '',
          });
        }
        break;
      }
      case 'removeServer': {
        const url = message.url;
        if (!url) break;

        const currentSettings = await settingsMgr.get();
        const newServers = currentSettings.servers.filter((s) => s.url !== url);
        const newServerUrl = currentSettings.serverUrl === url ? '' : currentSettings.serverUrl;

        await settingsMgr.update({
          servers: newServers,
          serverUrl: newServerUrl,
        });

        void host.postMessage({
          type: 'serverListUpdated',
          servers: newServers,
          serverUrl: newServerUrl ?? '',
        });
        break;
      }
      case 'switchToLocal': {
        await settingsMgr.update({ serverUrl: '' });

        const updated = await settingsMgr.get();
        void host.postMessage({
          type: 'serverListUpdated',
          servers: updated.servers,
          serverUrl: '',
        });
        break;
      }
      case 'selectAttachments': {
        try {
          const extensionMode = vscode.ExtensionMode;
          const isTestMode =
            extensionMode?.Test !== undefined &&
            context.extensionMode === extensionMode.Test;
          if (isTestMode && process.env.E2E_MOCK_ATTACHMENTS === '1') {
            const mockUris = [vscode.Uri.joinPath(context.extensionUri, 'README.md')];
            const attachments = await Promise.all(
              mockUris.map(async (uri) => {
                const label = toAttachmentLabel(uri);
                let sizeBytes: number | undefined;
                try {
                  const stat = await vscode.workspace.fs.stat(uri);
                  sizeBytes = stat.size;
                } catch (err) {
                  console.warn('[OpenHands] Failed to stat attachment', err);
                }
                return { uri: uri.toString(), label, sizeBytes };
              })
            );
            void host.postMessage({ type: 'attachmentsSelected', attachments });
            break;
          }

          const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            defaultUri,
            openLabel: 'Attach',
          });
          if (!picked || picked.length === 0) break;

          const attachments = await Promise.all(
            picked.map(async (uri) => {
              const label = toAttachmentLabel(uri);
              let sizeBytes: number | undefined;
              try {
                const stat = await vscode.workspace.fs.stat(uri);
                sizeBytes = stat.size;
              } catch (err) {
                console.warn('[OpenHands] Failed to stat attachment', err);
              }
              return { uri: uri.toString(), label, sizeBytes };
            })
          );
          void host.postMessage({ type: 'attachmentsSelected', attachments });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to select attachments: ${reason}`);
        }
        break;
      }
      case 'openAttachment': {
        const raw = message.uri;
        if (!raw) break;
        try {
          const uri = vscode.Uri.parse(raw, true);
          const document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open attachment: ${reason}`);
        }
        break;
      }
      case 'send': {
        if (!conversation) break;
        const baseText = message.text;
        const contextFiles = Array.isArray(message.contextFiles)
          ? message.contextFiles.filter((f): f is string => typeof f === 'string' && f.length > 0)
          : [];
        const attachmentUris = Array.isArray(message.attachments)
          ? message.attachments
            .filter((u): u is string => typeof u === 'string' && u.length > 0)
            .map((u) => safeParseUri(u))
            .filter((u): u is vscode.Uri => u !== undefined)
          : [];

        const attachmentsText = await buildAttachmentBlocks(attachmentUris);

        let finalText = baseText;
        if (attachmentsText) {
          finalText += attachmentsText;
        }
        if (contextFiles.length > 0) {
          finalText += `\n\nUser has selected the following files for you to read:\n${contextFiles.join('\n')}`;
        }
        await conversation.sendUserMessage(finalText);
        break;
      }
      case 'command': {
        switch (message.command) {
          case 'reconnect':
            conversation?.reconnect();
            break;
          case 'pause':
            await conversation?.pause();
            break;
          case 'startNewConversation':
            await conversation?.startNewConversation();
            break;
          case 'approveAction':
            await conversation?.approveAction();
            break;
          case 'rejectAction':
            await conversation?.rejectAction(message.reason);
            break;
          default:
            console.warn(`Unknown command received from webview: ${message.command}`);
            break;
        }
        break;
      }
      case 'renderedEventsResponse':
        deps.onRenderedEventsResponse(message.requestId, {
          count: message.count,
          eventTypes: message.eventTypes,
          events: message.events,
        });
        break;
      case 'uiStateResponse':
        deps.onUiStateResponse(message.requestId, {
          input: message.input,
          showContextPicker: message.showContextPicker,
          showSkillsPopover: message.showSkillsPopover,
          showHistory: message.showHistory,
          workspaceFilesCount: message.workspaceFilesCount,
          selectedContextFiles: message.selectedContextFiles,
          skillsCount: message.skillsCount,
          attachmentsCount: message.attachmentsCount,
        });
        break;
      case 'webviewConsole': {
        if (!deps.isDevBridgeEnabled()) break;
        outputChannel?.appendLine(`[webview ${message.level}] ${message.args.join(' ')}`);
        deps.fileLog(`[console.${message.level}] ${message.args.join(' ')}`);
        break;
      }
      case 'webviewError': {
        if (!deps.isDevBridgeEnabled()) break;
        outputChannel?.appendLine(`[webview error] ${message.message}`);
        if (message.stack) outputChannel?.appendLine(message.stack);
        deps.fileLog(`[error] ${message.message}${message.stack ? `\n${message.stack}` : ''}`);
        break;
      }
      case 'webviewNetwork': {
        if (!deps.isDevBridgeEnabled()) break;
        const line = `[webview net] ${message.phase} id=${message.id} ${message.method} ${message.url}${message.status !== undefined ? ` status=${message.status} ok=${message.ok}` : ''}`;
        outputChannel?.appendLine(line);
        deps.fileLog(line);
        break;
      }
      case 'webviewWebSocket': {
        if (!deps.isDevBridgeEnabled()) break;
        const parts = [`[webview ws] ${message.phase}`];
        if (message.url) parts.push(`url=${message.url}`);
        if (message.code !== undefined) parts.push(`code=${message.code}`);
        if (message.reason) parts.push(`reason=${message.reason}`);
        outputChannel?.appendLine(parts.join(' '));
        deps.fileLog(parts.join(' '));
        break;
      }
    }
  };
}
