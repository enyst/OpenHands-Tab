import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentContext,
  Conversation,
  type ConversationInstance,
  listProfiles,
  loadSkillsFromDir,
  type SecretRegistry,
  type Skill,
  Workspace,
} from '@smolpaws/agent-sdk';
import { bootstrapCloudRemoteConversation, type CloudBootstrapResult } from '../cloud/cloudRemoteBootstrap';
import { getServerCloudApiKeySecretKey } from '../auth/serverCloudApiKeys';
import { getServerRuntimeSessionApiKeySecretKey } from '../auth/serverRuntimeSessionApiKeys';
import { type OpenHandsSettings, SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { resolveLocalTools } from '../shared/localTools';
import { isOpenHandsCloudServerUrl } from '../shared/cloudServers';
import { resolveConfiguredLlmLabel } from '../shared/llmProfiles';
import { resolvePreferredWorkspaceRoot } from '../shared/workspaceRoot';
import { type HostToWebviewMessage, STATUS_MESSAGE_DISMISS_DELAY_MS } from '../shared/webviewMessages';
import { resolveConversationStoreRoot } from './conversationStoreRoot';
import { normalizeOutputVerbosity, type OutputVerbosity } from './outputLogger';

export type EnsureConversationOptions = {
  uiJustCreated?: boolean;
  modeSwitched?: boolean;
};

export type ConversationLifecycleDeps = {
  context: vscode.ExtensionContext;
  secrets: SecretRegistry;
  renderError: (err: unknown) => string;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  setOutputVerbosity: (verbosity: OutputVerbosity) => void;
  setVerboseEventLogging: (verbose: boolean) => void;
  hasChatView: () => boolean;
  isChatWebviewReady: () => boolean;
  postWebviewMessage: (message: HostToWebviewMessage) => void;
  getConversation: () => ConversationInstance | undefined;
  setConversation: (next: ConversationInstance | undefined) => void;
  getConversationMode: () => 'local' | 'remote';
  setConversationMode: (mode: 'local' | 'remote') => void;
  getPastedImagesBaseDir: () => string;
  setConversationStoreRoot: (root: string | undefined) => void;
  setLocalAgentContext: (ctx: AgentContext | undefined) => void;
  getLastKnownLlmLabel: () => string | null;
  setLastKnownLlmLabel: (label: string | null) => void;
  getLastRemoteServerUrl: () => string | undefined;
  setLastRemoteServerUrl: (url: string | undefined) => void;
  getLastRemoteAuthPromptAtMs: () => number;
  setLastRemoteAuthPromptAtMs: (value: number) => void;
  getCloudRemoteBootstrap: () => CloudBootstrapResult | null;
  setCloudRemoteBootstrap: (bootstrap: CloudBootstrapResult | null) => void;
  resetFileEditNoteTracker: () => void;
  resetConversationEventBacklog: (conversationId: string | undefined) => void;
  clearPrintedExitFor: () => void;
  syncActiveEditorSystemMessageSuffix: (editor: vscode.TextEditor | undefined) => void;
  syncLocalUserMessageSuffix: () => void;
  getActiveTextEditor: () => vscode.TextEditor | undefined;
  attachConversationListeners: (conversation: ConversationInstance) => void;
};

export function createConversationLifecycleOrchestrator(deps: ConversationLifecycleDeps): {
  ensureConversationAndConnection: (options?: EnsureConversationOptions) => Promise<void>;
} {
  const { context, secrets } = deps;

  const trimOrEmpty = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

  const withRemoteSecrets = (
    settings: OpenHandsSettings,
    params: { cloudApiKey?: string; runtimeSessionApiKey?: string },
  ): OpenHandsSettings => {
    const nextSecrets = { ...(settings.secrets ?? {}) } as Record<string, unknown>;
    if (params.cloudApiKey) nextSecrets.cloudApiKey = params.cloudApiKey;
    else delete nextSecrets.cloudApiKey;
    if (params.runtimeSessionApiKey) nextSecrets.runtimeSessionApiKey = params.runtimeSessionApiKey;
    else delete nextSecrets.runtimeSessionApiKey;
    return { ...settings, secrets: nextSecrets as OpenHandsSettings['secrets'] };
  };

  async function ensureConversationAndConnection(options?: EnsureConversationOptions): Promise<void> {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    let settings = await settingsMgr.get();
    deps.setLastKnownLlmLabel(resolveConfiguredLlmLabel(settings));

    if (typeof settings.serverUrl === 'string' && settings.serverUrl.trim()) {
      const rawServerUrl = settings.serverUrl.trim();
      deps.setLastRemoteServerUrl(rawServerUrl);
      const isCloud = isOpenHandsCloudServerUrl(rawServerUrl);

      const cloudKeyInfo = isCloud ? getServerCloudApiKeySecretKey(rawServerUrl) : null;
      const runtimeKeyInfo = getServerRuntimeSessionApiKeySecretKey(rawServerUrl);

      let cloudApiKey: string | undefined;
      if (cloudKeyInfo?.ok) {
        try {
          cloudApiKey = trimOrEmpty(await context.secrets.get(cloudKeyInfo.secretKey)) || undefined;
        } catch {
          cloudApiKey = undefined;
        }
      }

      let runtimeSessionApiKey: string | undefined;
      if (runtimeKeyInfo.ok) {
        try {
          runtimeSessionApiKey = trimOrEmpty(await context.secrets.get(runtimeKeyInfo.secretKey)) || undefined;
        } catch {
          runtimeSessionApiKey = undefined;
        }
      }

      settings = withRemoteSecrets(settings, { cloudApiKey, runtimeSessionApiKey });
    }

    const cfg = vscode.workspace.getConfiguration();
    const verbosity = normalizeOutputVerbosity(cfg.get<string>('openhands.logging.verbosity'));
    deps.setOutputVerbosity(verbosity);
    deps.setVerboseEventLogging(
      verbosity === 'verbose'
      || Boolean(settings.agent?.debug)
      || Boolean(cfg.get<boolean>('openhands.devBridge.enabled')),
    );

    if (!settings.serverUrl && settings.agent?.summarizeToolCalls === true) {
      const hasGeminiKey = await (async (): Promise<boolean> => {
        let storedGeminiKey: string | undefined;
        try {
          storedGeminiKey = await context.secrets.get('GEMINI_API_KEY');
        } catch {
          storedGeminiKey = undefined;
        }
        if (typeof storedGeminiKey === 'string' && storedGeminiKey.trim()) return true;
        if (typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim()) return true;

        if (settings.llm.provider === 'gemini') {
          const mainKey = settings.secrets.llmApiKey;
          if (typeof mainKey === 'string' && mainKey.trim()) return true;
        }

        return false;
      })();

      if (!hasGeminiKey) {
        try {
          await settingsMgr.update({ agent: { ...settings.agent, summarizeToolCalls: false } });
          settings = await settingsMgr.get();
        } catch (err) {
          deps.getOutputChannel()?.appendLine(`[settings] Failed to auto-disable tool summarization: ${deps.renderError(err)}`);
        }

        if (deps.hasChatView()) {
          deps.postWebviewMessage({
            type: 'statusMessage',
            level: 'error',
            message: 'No Gemini key found, tool summarization disabled',
            autoDismiss: true,
            autoDismissDelay: STATUS_MESSAGE_DISMISS_DELAY_MS,
          } satisfies HostToWebviewMessage);
        }
      }
    }

    const workspaceRoot = resolvePreferredWorkspaceRoot();

    const desiredMode: 'local' | 'remote' = settings.serverUrl ? 'remote' : 'local';
    const savedIdKey = desiredMode === 'local' ? 'openhands.conversationId.local' : 'openhands.conversationId.remote';
    const rawServerUrl = typeof settings.serverUrl === 'string' ? settings.serverUrl.trim() : '';
    const isCloudRemote = desiredMode === 'remote' && rawServerUrl ? isOpenHandsCloudServerUrl(rawServerUrl) : false;

    if (options?.modeSwitched) {
      deps.resetConversationEventBacklog(undefined);
      deps.clearPrintedExitFor();
      await context.workspaceState.update(savedIdKey, undefined);
    }

    let savedId = (options?.uiJustCreated || options?.modeSwitched)
      ? undefined
      : context.workspaceState.get<string>(savedIdKey);

    if (isCloudRemote) {
      savedId = undefined;
      await context.workspaceState.update(savedIdKey, undefined);
    }

    if (savedId) {
      const looksLocal = savedId.startsWith('local-');
      const matchesDesiredMode = desiredMode === 'local' ? looksLocal : !looksLocal;
      if (!matchesDesiredMode) savedId = undefined;
    }

    let currentConversation = deps.getConversation();
    const needsNewConversation = !currentConversation || deps.getConversationMode() !== desiredMode;

    if (needsNewConversation) {
      try {
        currentConversation?.removeAllListeners();
        currentConversation?.disconnect();
      } catch {
        // best-effort cleanup
      }
      deps.resetFileEditNoteTracker();
      deps.setCloudRemoteBootstrap(null);

      const persistenceDir =
        desiredMode === 'local'
          ? await resolveConversationStoreRoot({
              context,
              getOutputChannel: deps.getOutputChannel,
              renderError: deps.renderError,
            }).catch((err: unknown) => {
              deps.getOutputChannel()?.appendLine(`[storage] Failed to resolve conversation store root: ${deps.renderError(err)}`);
              return path.join(os.tmpdir(), 'openhands-conversations-vscode');
            })
          : undefined;
      deps.setConversationStoreRoot(persistenceDir);

      const agentContext = (() => {
        if (desiredMode !== 'local' || !workspaceRoot) return undefined;

        const skillsDir = path.join(workspaceRoot, '.openhands', 'skills');
        let skills: Skill[] = [];
        try {
          const { repoSkills, knowledgeSkills, agentSkills } = loadSkillsFromDir(skillsDir);
          skills = [...repoSkills.values(), ...knowledgeSkills.values(), ...agentSkills.values()];
        } catch (err) {
          deps.getOutputChannel()?.appendLine(`[skills] Failed to load project skills from ${skillsDir}: ${deps.renderError(err)}`);
        }

        return new AgentContext({
          skills,
          loadUserSkills: true,
        });
      })();

      deps.setLocalAgentContext(desiredMode === 'local' ? agentContext : undefined);
      if (desiredMode === 'local') {
        deps.syncActiveEditorSystemMessageSuffix(deps.getActiveTextEditor());
      }

      let effectiveServerUrl = settings.serverUrl ?? undefined;
      let bootstrapConversationId: string | undefined;
      if (desiredMode === 'remote' && isCloudRemote) {
        const cloudApiKey = settings.secrets?.cloudApiKey ?? '';
        if (!cloudApiKey) {
          const action = await vscode.window.showWarningMessage(
            'OpenHands Cloud: Login required to start a cloud runtime.',
            'Login',
            'Dismiss',
          );
          if (action === 'Login') {
            await vscode.commands.executeCommand('openhands.cloudLogin');
          }
          throw new Error('OpenHands Cloud: missing Cloud API Key.');
        }

        const bootstrap = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'OpenHands Cloud: starting runtime…' },
          async () => bootstrapCloudRemoteConversation({ saasServerUrl: rawServerUrl, cloudApiKey }),
        );
        deps.setCloudRemoteBootstrap(bootstrap);
        bootstrapConversationId = bootstrap.conversationId;
        effectiveServerUrl = bootstrap.nestedServerUrl;
        settings = withRemoteSecrets(settings, { cloudApiKey, runtimeSessionApiKey: bootstrap.runtimeSessionApiKey });
        savedId = bootstrapConversationId;
      }

      const remoteWorkspace = desiredMode === 'remote' && effectiveServerUrl
        ? Workspace({
          kind: 'remote',
          serverUrl: effectiveServerUrl,
          workingDir: workspaceRoot,
          cloudApiKey: settings.secrets?.cloudApiKey,
          runtimeSessionApiKey: settings.secrets?.runtimeSessionApiKey,
        })
        : undefined;

      const conversationOptions = {
        settings,
        workspace: remoteWorkspace,
        workspaceRoot: desiredMode === 'local' ? workspaceRoot : undefined,
        tools: desiredMode === 'local' ? resolveLocalTools() : undefined,
        secrets,
        persistenceDir,
        agentContext,
        pastedImagesBaseDir: deps.getPastedImagesBaseDir(),
        conversationId: bootstrapConversationId,
      };

      if (desiredMode === 'local' && agentContext) {
        deps.syncLocalUserMessageSuffix();
      }

      let nextConversation: ConversationInstance;
      try {
        nextConversation = Conversation(conversationOptions);
      } catch (err) {
        deps.getOutputChannel()?.appendLine(`[error] Failed to create Conversation: ${deps.renderError(err)}`);
        if (desiredMode === 'local' && persistenceDir) {
          const fallbackDir = path.join(os.tmpdir(), 'openhands-conversations-vscode');
          deps.getOutputChannel()?.appendLine(`[storage] Retrying Conversation with fallback dir: ${fallbackDir}`);
          deps.setConversationStoreRoot(fallbackDir);
          nextConversation = Conversation({ ...conversationOptions, persistenceDir: fallbackDir });
        } else {
          throw err;
        }
      }

      deps.setConversation(nextConversation);
      currentConversation = nextConversation;
      deps.setConversationMode(desiredMode);

      deps.attachConversationListeners(nextConversation);

      nextConversation.on('error', (err: unknown) => {
        void (async () => {
          if (deps.getConversationMode() !== 'remote') return;

          const message = err instanceof Error ? err.message : String(err);
          const isAuthFailure = /\(HTTP (401|403)\)/.test(message) && message.toLowerCase().includes('authentication failed');
          if (!isAuthFailure) return;

          const now = Date.now();
          if (now - deps.getLastRemoteAuthPromptAtMs() < 60_000) return;
          deps.setLastRemoteAuthPromptAtMs(now);

          const serverUrl = deps.getLastRemoteServerUrl();
          const isCloudServer = typeof serverUrl === 'string' && serverUrl.trim().length > 0
            ? isOpenHandsCloudServerUrl(serverUrl)
            : false;

          const action = await vscode.window.showWarningMessage(
            isCloudServer
              ? 'OpenHands: Authentication failed connecting to OpenHands Cloud. Login now?'
              : 'OpenHands: Authentication failed connecting to the selected server. Set Runtime Session API Key now?',
            isCloudServer ? 'Login' : 'Set Key',
            'Dismiss',
          );
          if (!action || action === 'Dismiss') return;

          if (isCloudServer && action === 'Login') {
            await vscode.commands.executeCommand('openhands.cloudLogin');
            return;
          }
          if (!isCloudServer && action === 'Set Key') {
            await vscode.commands.executeCommand('openhands.setRuntimeSessionApiKey');
          }
        })();
      });

      if (savedId) {
        try {
          const maybe = nextConversation.restoreConversation(savedId);
          void Promise.resolve(maybe).catch((err: unknown) => {
            deps.getOutputChannel()?.appendLine(`[restoreConversation] ${deps.renderError(err)}`);
          });
        } catch (err) {
          deps.getOutputChannel()?.appendLine(`[restoreConversation] ${deps.renderError(err)}`);
        }
      }
    } else if (currentConversation) {
      if (isCloudRemote && deps.getCloudRemoteBootstrap()?.saasServerUrl) {
        const bootstrap = deps.getCloudRemoteBootstrap();
        if (bootstrap) {
          const normalizedBootstrapSaas = bootstrap.saasServerUrl;
          const normalizedCurrent = typeof settings.serverUrl === 'string' ? settings.serverUrl.trim().replace(/\/$/, '') : '';
          if (normalizedCurrent && normalizedCurrent === normalizedBootstrapSaas) {
            settings = withRemoteSecrets(settings, {
              cloudApiKey: settings.secrets?.cloudApiKey ?? undefined,
              runtimeSessionApiKey: bootstrap.runtimeSessionApiKey,
            });
          }
        }
      }
      currentConversation.setSettings(settings);
    } else {
      deps.getOutputChannel()?.appendLine('[warn] Conversation unavailable during settings refresh');
    }

    if (deps.hasChatView() && deps.isChatWebviewReady()) {
      deps.postWebviewMessage({
        type: 'status',
        status: currentConversation?.getStatus() ?? 'offline',
        mode: deps.getConversationMode(),
        llmProfileLabel: deps.getLastKnownLlmLabel(),
      } satisfies HostToWebviewMessage);

      try {
        deps.postWebviewMessage({
          type: 'llmProfilesUpdated',
          profiles: listProfiles(),
          activeProfileId: settings.llm.profileId ?? null,
        } satisfies HostToWebviewMessage);
      } catch (err) {
        deps.getOutputChannel()?.appendLine(`[llm] Failed to list profiles for webview sync: ${deps.renderError(err)}`);
      }
    }
  }

  return {
    ensureConversationAndConnection,
  };
}
