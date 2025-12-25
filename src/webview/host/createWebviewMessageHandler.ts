import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';
import { assertValidProfileId, detectProviderFromBaseUrl, LLMProfileValidationError, type LLMProvider, type SecretRegistry } from '@openhands/agent-sdk-ts';
import { SettingsManager } from '../../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../../settings/VscodeSettingsAdapter';
import { ElevenLabsTtsService } from '../../hal/elevenlabs/ttsService';
import { TtsConversationGate } from '../../hal/elevenlabs/ttsConversationGate';
import { classifyHalVoiceDecision } from '../../hal/gemini/decisionClassifier';
import { getHalDialogueLinesForMode } from '../../shared/halScript';
import { resolveConfiguredLlmLabel } from '../../shared/llmProfiles';
import { OPENHANDS_IMAGE_URL_PREFIX, getGlobalStorageBaseDir, getPastedImagePath, parseBase64DataImageUrl, rewriteDataImageMarkdown, rewriteOpenHandsImageUrls } from '../../shared/pastedImages';
import { MAX_PASTED_IMAGE_BYTES } from '../../shared/pasteLimits';
import { normalizeServerUrl } from '../../shared/serverUrls';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/webviewMessages';
import { buildAttachmentBlocks, safeParseUri, toAttachmentLabel } from './attachments';
import { getConversationHistoryList } from './conversationHistory';
import { showWorkspaceDiff } from './diffDocuments';
import { resolveGitHeadDiffContents } from './gitHeadDiff';
import * as llmProfilesStore from './llmProfilesStore';
import { listSkillFiles } from './skills';
import { listWorkspaceFiles } from './workspaceFiles';
import { resolveWorkspaceFilePath } from './workspacePaths';

export type WebviewHost = {
  postMessage: (message: HostToWebviewMessage) => Thenable<boolean>;
};

function execFileText(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim() : err.message;
        reject(new Error(message));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

async function persistPastedImage(baseDir: string, imageId: string, bytes: Uint8Array): Promise<void> {
  const filePath = getPastedImagePath(baseDir, imageId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

export type CreateWebviewMessageHandlerDeps = {
  context: vscode.ExtensionContext;
  host: WebviewHost;
  secretRegistry?: SecretRegistry;

  getConversation: () => import('@openhands/agent-sdk-ts').ConversationInstance | undefined;
  getConversationMode: () => 'local' | 'remote';
  getConversationStoreRoot: () => string | undefined;
  resolveConversationStoreRoot: () => Promise<string>;

  /**
   * Optional override for the LLM profile store root directory. Defaults to `~/.openhands/llm-profiles`.
   * Intended for tests only (no workspace overrides).
   */
  getLlmProfilesStoreRoot?: () => string | undefined;

  setWebviewReadyState: (conversationId?: string, lastSeenSeq?: number) => void;
  setLastKnownLlmLabel: (label: string | null) => void;
  getLastKnownLlmLabel: () => string | null;

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
  onHalStateResponse: (
    requestId: string,
    info: {
      enabled: boolean;
      mode: string;
      phase: string;
      eye: string;
      stepIndex: number | null;
      decision: string | null;
      lastError: string | null;
    }
  ) => void;

  isDevBridgeEnabled: () => boolean;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  fileLog: (line: string) => void;
};

export function createWebviewMessageHandler(deps: CreateWebviewMessageHandlerDeps) {
  const { context, host } = deps;
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
  const elevenlabsCacheMaxBytes = 50 * 1024 * 1024;
  let elevenlabsTtsGate: TtsConversationGate | null = null;

  const postStatusError = (message: string): void => {
    void host.postMessage({
      type: 'statusMessage',
      level: 'error',
      message,
      autoDismiss: true,
      autoDismissDelay: 6000,
    });
  };

  const validateProfileId = (profileId: string): void => {
    try {
      assertValidProfileId(profileId);
    } catch (err) {
      if (err instanceof LLMProfileValidationError) {
        throw new Error(err.message);
      }
      throw err;
    }
  };

  const getProfileApiKeySecretKey = (profileId: string): string => {
    validateProfileId(profileId);
    return `openhands.llmProfileApiKey.${profileId}`;
  };

  const getProviderApiKeyName = (provider: LLMProvider): string => {
    switch (provider) {
      case 'openrouter':
        return 'OPENROUTER_API_KEY';
      case 'litellm_proxy':
        return 'LITELLM_API_KEY';
      case 'anthropic':
        return 'ANTHROPIC_API_KEY';
      case 'gemini':
        return 'GEMINI_API_KEY';
      default:
        return 'OPENAI_API_KEY';
    }
  };

  const hasStoredSecret = async (key: string): Promise<boolean> => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return false;
    const resolved = deps.secretRegistry
      ? await deps.secretRegistry.get(trimmedKey)
      : (process.env[trimmedKey] ?? (await context.secrets.get(trimmedKey)));
    return typeof resolved === 'string' && resolved.trim().length > 0;
  };

  const getElevenlabsTtsGate = (): TtsConversationGate => {
    if (elevenlabsTtsGate) return elevenlabsTtsGate;
    const baseDir = context.globalStorageUri?.fsPath || path.join(os.tmpdir(), 'oh-tab-global-storage');
    const cacheDir = path.join(baseDir, 'hal', 'elevenlabs', 'tts-cache');
    elevenlabsTtsGate = new TtsConversationGate(
      new ElevenLabsTtsService({
        cacheDir,
        maxCacheBytes: elevenlabsCacheMaxBytes,
      })
    );
    return elevenlabsTtsGate;
  };

  return async (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const message = msg as WebviewToHostMessage;

    const outputChannel = deps.getOutputChannel();
    const conversation = deps.getConversation();

    const llmProfileStoreOptions = (): { rootDir?: string } => {
      const rootDir = typeof deps.getLlmProfilesStoreRoot === 'function' ? deps.getLlmProfilesStoreRoot() : undefined;
      if (typeof rootDir !== 'string') return {};
      const trimmed = rootDir.trim();
      return trimmed ? { rootDir: trimmed } : {};
    };

    const listAvailableLlmProfiles = (): string[] => {
      try {
        return llmProfilesStore.listProfiles(llmProfileStoreOptions());
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        outputChannel?.appendLine(`[llm] Failed to list profiles: ${reason}`);
        return [];
      }
    };

    const sendHistoryList = async (): Promise<void> => {
      try {
        const convRoot = deps.getConversationStoreRoot() ?? (await deps.resolveConversationStoreRoot());
        const conversations = await getConversationHistoryList(convRoot, outputChannel);
        void host.postMessage({ type: 'historyList', conversations });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        outputChannel?.appendLine(`[history] ${reason}`);
        void host.postMessage({ type: 'historyList', conversations: [] });
      }
    };

    switch (message.type) {
      case 'webviewReady': {
        deps.setWebviewReadyState(message.conversationId, message.lastSeenSeq);

        const initSettings = await settingsMgr.get();
        const serverWarnings = settingsMgr.drainServerNormalizationWarnings();
        for (const warning of serverWarnings) {
          postStatusError(warning);
        }
        deps.setLastKnownLlmLabel(resolveConfiguredLlmLabel(initSettings));

        void host.postMessage({
          type: 'status',
          status: conversation?.getStatus() ?? 'offline',
          mode: deps.getConversationMode(),
          llmProfileLabel: deps.getLastKnownLlmLabel(),
        });

        void host.postMessage({
          type: 'llmProfilesUpdated',
          profiles: listAvailableLlmProfiles(),
          activeProfileId: initSettings.llm.profileId ?? null,
        });

        void host.postMessage({
          type: 'serverListUpdated',
          servers: initSettings.servers,
          serverUrl: initSettings.serverUrl ?? '',
        });

        void host.postMessage({
          type: 'elevenlabsSettings',
          elevenlabs: initSettings.elevenlabs,
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
          const { resolvedPath } = resolveWorkspaceFilePath(p);
          await fs.stat(resolvedPath);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open file: ${reason}`);
        }
        break;
      }
      case 'openMarkdownLink': {
        const raw = typeof message.href === 'string' ? message.href.trim() : '';
        if (!raw || raw.startsWith('#')) break;

        // Only allow http(s)/mailto links and workspace-internal file links.
        if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) {
          const uri = safeParseUri(raw);
          if (!uri || (uri.scheme !== 'http' && uri.scheme !== 'https' && uri.scheme !== 'mailto')) {
            void vscode.window.showErrorMessage('Blocked unsafe link.');
            break;
          }
          await vscode.env.openExternal(uri);
          break;
        }

        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wsRoot) {
          void vscode.window.showErrorMessage('Cannot open link: no workspace folder is open.');
          break;
        }

        const withoutFragment = raw.split('#')[0];
        const withoutQuery = withoutFragment.split('?')[0];
        const inputPath = withoutQuery.trim();
        if (!inputPath) break;

        const resolvedPath = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(wsRoot, inputPath);
        const rel = path.relative(wsRoot, resolvedPath);
        const inWorkspace = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        if (!inWorkspace) {
          void vscode.window.showErrorMessage('Blocked unsafe link.');
          break;
        }

        try {
          await fs.stat(resolvedPath);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open link: ${reason}`);
        }
        break;
      }
      case 'openWorkspaceDiff': {
        const p = message.path;
        if (!p) break;
        if (typeof message.oldContent !== 'string' || typeof message.newContent !== 'string') {
          void vscode.window.showErrorMessage('Failed to open diff: missing diff content.');
          break;
        }
        try {
          let oldContent = message.oldContent;
          let newContent = message.newContent;

          if (message.preferGitHead === true) {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const { resolvedPath } = resolveWorkspaceFilePath(p);
            const resolved = await resolveGitHeadDiffContents({
              workspaceRoot: wsRoot,
              resolvedPath,
              fallbackOldContent: '',
              fallbackNewContent: newContent,
              execFileText,
              readFileText: (filePath) => fs.readFile(filePath, 'utf8'),
            });
            oldContent = resolved.oldContent;
            newContent = resolved.newContent;
          }

          await showWorkspaceDiff({ context, filePath: p, oldContent, newContent });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`Failed to open diff: ${reason}`);
        }
        break;
      }
      case 'requestHistory': {
        await sendHistoryList();
        break;
      }
      case 'deleteConversation': {
        const id = message.id;
        if (!id) break;
        const activeConversationId = conversation?.getConversationId?.();
        if (activeConversationId && activeConversationId === id) {
          void vscode.window.showWarningMessage('Cannot delete the active conversation.');
          break;
        }
        try {
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            throw new Error('Invalid conversation id');
          }
          const convRoot = deps.getConversationStoreRoot() ?? (await deps.resolveConversationStoreRoot());
          const resolvedRoot = path.resolve(convRoot);
          const targetDir = path.resolve(convRoot, id);
          const relative = path.relative(resolvedRoot, targetDir);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Invalid conversation id');
          }
          await fs.rm(targetDir, { recursive: true, force: true });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          outputChannel?.appendLine(`[history] Failed to delete ${id}: ${reason}`);
          void vscode.window.showErrorMessage(`Failed to delete conversation: ${reason}`);
        }
        await sendHistoryList();
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
      case 'setLlmProfileId': {
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        await settingsMgr.update({ llm: { profileId } });

        const updated = await settingsMgr.get();
        deps.setLastKnownLlmLabel(resolveConfiguredLlmLabel(updated));

        void host.postMessage({
          type: 'status',
          status: conversation?.getStatus() ?? 'offline',
          mode: deps.getConversationMode(),
          llmProfileLabel: deps.getLastKnownLlmLabel(),
        });

        void host.postMessage({
          type: 'llmProfilesUpdated',
          profiles: listAvailableLlmProfiles(),
          activeProfileId: updated.llm.profileId ?? null,
        });
        break;
      }
      case 'llmProfilesListRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        if (!requestId) break;
        try {
          const profiles = listAvailableLlmProfiles();
          void host.postMessage({ type: 'llmProfilesListResponse', requestId, ok: true, profiles });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfilesListResponse', requestId, ok: false, error: reason });
        }
        break;
      }
      case 'llmProfileLoadRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        if (!requestId || !profileId) break;

        try {
          const profile = llmProfilesStore.loadProfile(profileId, llmProfileStoreOptions());
          void host.postMessage({
            type: 'llmProfileLoadResponse',
            requestId,
            ok: true,
            profileId: profile.profileId,
            profile: profile.config,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfileLoadResponse', requestId, ok: false, profileId, error: reason });
        }
        break;
      }
      case 'llmProfileSaveRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        if (!requestId || !profileId) break;

        try {
          llmProfilesStore.saveProfile(profileId, message.profile, llmProfileStoreOptions());
          void host.postMessage({ type: 'llmProfileSaveResponse', requestId, ok: true, profileId });

          const updated = await settingsMgr.get();
          void host.postMessage({
            type: 'llmProfilesUpdated',
            profiles: listAvailableLlmProfiles(),
            activeProfileId: updated.llm.profileId ?? null,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfileSaveResponse', requestId, ok: false, profileId, error: reason });
        }
        break;
      }
      case 'llmProfileDeleteRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        if (!requestId || !profileId) break;

        try {
          llmProfilesStore.deleteProfile(profileId, llmProfileStoreOptions());
          const key = getProfileApiKeySecretKey(profileId);
          await context.secrets.delete(key);
          deps.secretRegistry?.set(key, undefined);
          void host.postMessage({ type: 'llmProfileDeleteResponse', requestId, ok: true, profileId });

          const before = await settingsMgr.get();
          const activeProfileId = before.llm.profileId ?? null;
          if (activeProfileId === profileId) {
            await settingsMgr.update({ llm: { profileId: '' } });
            void host.postMessage({
              type: 'statusMessage',
              level: 'error',
              message: `Active LLM profile '${profileId}' was deleted; selection cleared.`,
              autoDismiss: true,
              autoDismissDelay: 8000,
            });
          } else {
            void host.postMessage({
              type: 'statusMessage',
              level: 'info',
              message: `Deleted profile '${profileId}'.`,
              autoDismiss: true,
              autoDismissDelay: 4000,
            });
          }

          const updated = await settingsMgr.get();
          deps.setLastKnownLlmLabel(resolveConfiguredLlmLabel(updated));

          void host.postMessage({
            type: 'status',
            status: conversation?.getStatus() ?? 'offline',
            mode: deps.getConversationMode(),
            llmProfileLabel: deps.getLastKnownLlmLabel(),
          });

          void host.postMessage({
            type: 'llmProfilesUpdated',
            profiles: listAvailableLlmProfiles(),
            activeProfileId: updated.llm.profileId ?? null,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfileDeleteResponse', requestId, ok: false, profileId, error: reason });
        }
        break;
      }
      case 'llmProfileApiKeyStatusRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        if (!requestId || !profileId) break;

        try {
          const key = getProfileApiKeySecretKey(profileId);
          const stored = await context.secrets.get(key);
          const hasProfileKey = typeof stored === 'string' && stored.trim().length > 0;
          const profile = llmProfilesStore.loadProfile(profileId, llmProfileStoreOptions());
          const provider = profile.config.provider ?? detectProviderFromBaseUrl(profile.config.baseUrl);
          const providerKeyName = getProviderApiKeyName(provider);
          const hasProviderKey = await hasStoredSecret(providerKeyName);
          void host.postMessage({
            type: 'llmProfileApiKeyStatusResponse',
            requestId,
            ok: true,
            profileId,
            hasKey: hasProfileKey || hasProviderKey,
            hasProfileKey,
            hasProviderKey,
            providerKeyName,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfileApiKeyStatusResponse', requestId, ok: false, profileId, error: reason });
        }
        break;
      }
      case 'llmProfileApiKeySetRequest': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.trim() : '';
        const profileId = typeof message.profileId === 'string' ? message.profileId.trim() : '';
        const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
        if (!requestId || !profileId) break;

        try {
          const key = getProfileApiKeySecretKey(profileId);
          if (!apiKey) {
            await context.secrets.delete(key);
            deps.secretRegistry?.set(key, undefined);
          } else {
            await context.secrets.store(key, apiKey);
            deps.secretRegistry?.set(key, apiKey);
          }
          void host.postMessage({ type: 'llmProfileApiKeySetResponse', requestId, ok: true, profileId });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          void host.postMessage({ type: 'llmProfileApiKeySetResponse', requestId, ok: false, profileId, error: reason });
        }
        break;
      }
      case 'selectServer': {
        const rawUrl = typeof message.url === 'string' ? message.url.trim() : '';
        const url = rawUrl ? normalizeServerUrl(rawUrl) : { ok: true as const, url: '' };
        if (!url.ok) {
          postStatusError(url.error);
          break;
        }
        const currentSettings = await settingsMgr.get();

        const serverExists = currentSettings.servers.some((s) => s.url === url.url);
        if (!serverExists && url.url) {
          await settingsMgr.update({
            servers: [...currentSettings.servers, { url: url.url }],
            serverUrl: url.url,
          });
        } else {
          await settingsMgr.update({ serverUrl: url.url });
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

        const normalized = normalizeServerUrl(server.url);
        if (!normalized.ok) {
          postStatusError(normalized.error);
          break;
        }

        const label = typeof server.label === 'string' ? server.label.trim() : '';
        const canonicalServer = label ? { url: normalized.url, label } : { url: normalized.url };

        const currentSettings = await settingsMgr.get();
        const exists = currentSettings.servers.some((s) => s.url === normalized.url);
        if (!exists) {
          const newServers = [...currentSettings.servers, canonicalServer];
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
        const rawUrl = typeof message.url === 'string' ? message.url.trim() : '';
        if (!rawUrl) break;

        const normalized = normalizeServerUrl(rawUrl);
        if (!normalized.ok) {
          postStatusError(normalized.error);
          break;
        }
        const url = normalized.url;

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

        const globalStorageBaseDir = getGlobalStorageBaseDir(context.globalStorageUri?.fsPath);
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
              outputChannel?.appendLine(`[pasted-images] Failed to persist ${imageId}: ${reason}`);
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
        await conversation.sendUserMessage(finalText);
        break;
      }
      case 'halTtsRequest': {
        if (typeof message.requestId !== 'string' || typeof message.conversationId !== 'string') break;
        if (typeof message.stepIndex !== 'number' || !Number.isFinite(message.stepIndex)) break;
        const stepIndex = Math.trunc(message.stepIndex);
        if (stepIndex < 0) break;

        const settings = await settingsMgr.get();
        const script = getHalDialogueLinesForMode(settings.elevenlabs.userName, settings.elevenlabs.mode);
        const line = script[stepIndex];
        if (!line) {
          void host.postMessage({ type: 'halTtsResponse', requestId: message.requestId, ok: false, error: 'Invalid HAL script line', shouldNotify: true });
          break;
        }

        const apiKey = settings.secrets.elevenLabsApiKey ?? '';
        const voiceId = line.voice === 'voice_hal' ? (settings.elevenlabs.voiceAId ?? '') : (settings.elevenlabs.voiceUserId ?? '');

        const result = await getElevenlabsTtsGate().synthesize({
          conversationId: message.conversationId,
          apiKey,
          voiceId,
          text: line.text,
          modelId: settings.elevenlabs.modelId,
          cacheEnabled: settings.elevenlabs.cache,
        });

        if (result.ok) {
          void host.postMessage({
            type: 'halTtsResponse',
            requestId: message.requestId,
            ok: true,
            audioBase64: Buffer.from(result.bytes).toString('base64'),
            volume: settings.elevenlabs.volume,
          });
          break;
        }

        void host.postMessage({
          type: 'halTtsResponse',
          requestId: message.requestId,
          ok: false,
          error: result.error,
          shouldNotify: result.shouldNotify,
          disabled: result.disabled,
        });
        break;
      }
      case 'halVoiceConfirmRequest': {
        if (typeof message.requestId !== 'string') break;
        if (typeof message.mimeType !== 'string') break;
        if (typeof message.audioBase64 !== 'string' || message.audioBase64.length === 0) {
          void host.postMessage({ type: 'halVoiceConfirmResponse', requestId: message.requestId, ok: false, error: 'No audio provided' });
          break;
        }

        const settings = await settingsMgr.get();
        const result = await classifyHalVoiceDecision({
          baseUrl: settings.gemini.baseUrl,
          apiKey: settings.secrets.geminiApiKey ?? '',
          model: settings.gemini.model,
          mimeType: message.mimeType,
          audioBase64: message.audioBase64,
        });

        if (result.ok) {
          void host.postMessage({ type: 'halVoiceConfirmResponse', requestId: message.requestId, ok: true, decision: result.decision });
          break;
        }

        void host.postMessage({ type: 'halVoiceConfirmResponse', requestId: message.requestId, ok: false, error: result.error });
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
          case 'teleportAction':
            try {
              await vscode.commands.executeCommand('openhands._teleportToRemoteRuntime');
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              outputChannel?.appendLine(`[teleportAction] ${reason}`);
            }
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
      case 'halStateResponse':
        deps.onHalStateResponse(message.requestId, {
          enabled: message.enabled,
          mode: message.mode,
          phase: message.phase,
          eye: message.eye,
          stepIndex: message.stepIndex,
          decision: message.decision,
          lastError: message.lastError,
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
