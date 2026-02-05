import * as vscode from 'vscode';
import { SettingsManager } from '../../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../../settings/VscodeSettingsAdapter';
import { resolveConfiguredLlmLabel } from '../../shared/llmProfiles';

import type { WebviewE2EInfo, WebviewToHostMessage } from '../../shared/webviewMessages';
// Environment info is provided via AgentContext.userMessageSuffix (extension host).

import { listSkillFiles } from './skills';
import { listWorkspaceFiles } from './workspaceFiles';
import { getDefaultLocalToolIds, resolveLocalTools } from '../../shared/localTools';
import { handleWebviewConsole, handleWebviewError, handleWebviewNetwork, handleWebviewWebSocket } from './handlers/devBridge';
import { handleHalStateResponse, handleRenderedEventsResponse, handleUiStateResponse } from './handlers/stateResponses';
import { handleOpenMarkdownLink, handleOpenSkill, handleOpenWorkspaceDiff, handleOpenWorkspaceFile } from './handlers/openers';
import { handleOpenAttachment, handleSelectAttachments } from './handlers/attachments';
import { createPostToolsList, handleSetEnabledTools, isLocalConversationToolControls } from './handlers/tools';
import { handleDeleteConversation, handleRequestHistory, handleRestoreConversation } from './handlers/history';
import { handleAddServer, handleRemoveServer, handleSelectServer, handleSwitchToLocal } from './handlers/servers';
import { handleSend } from './handlers/send';
import { handleLlmProfileApiKeySetRequest, handleLlmProfileApiKeyStatusRequest, handleLlmProfileDeleteRequest, handleLlmProfileLoadRequest, handleLlmProfileSaveRequest, handleLlmProfilesListRequest, handleSetLlmProfileId, listAvailableLlmProfiles } from './handlers/llmProfiles';
import { computeWelcomeSecretStatus } from '../../shared/welcomeSecretStatus';
import { createElevenlabsTtsGateFactory, handleHalTtsRequest, handleHalVoiceConfirmRequest } from './handlers/hal';
import type { CreateWebviewMessageHandlerDeps } from './webviewMessageHandler.types';
export type { CreateWebviewMessageHandlerDeps, WebviewHost } from './webviewMessageHandler.types';

export function createWebviewMessageHandler(deps: CreateWebviewMessageHandlerDeps) {
  const { context, host } = deps;
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
  const getElevenlabsTtsGate = createElevenlabsTtsGateFactory({ context, maxCacheBytes: 50 * 1024 * 1024 });
  const historyTitleGenerationInFlight = new Set<string>();
  const extensionMode = vscode.ExtensionMode;
  const isProduction =
    extensionMode?.Production !== undefined ? context.extensionMode === extensionMode.Production : true;
  const e2eEnabled = !isProduction && process.env.E2E_UI === '1';

  const postToolsList = createPostToolsList({ deps, host });

  const postStatusError = (message: string): void => {
    void host.postMessage({
      type: 'statusMessage',
      level: 'error',
      message,
      autoDismiss: true,
      autoDismissDelay: 6000,
    });
  };

  const normalizeE2EInfo = (payload: WebviewE2EInfo | undefined): WebviewE2EInfo | null => {
    if (!payload || typeof payload !== 'object') return null;
    const host = typeof payload.host === 'string' ? payload.host : '';
    const pathname = typeof payload.pathname === 'string' ? payload.pathname : '';
    if (!host || !pathname) return null;
    const extensionId = typeof payload.extensionId === 'string' ? payload.extensionId : undefined;
    const title = typeof payload.title === 'string' ? payload.title : undefined;
    return { host, pathname, extensionId, title };
  };

  return async (msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    const message = msg as WebviewToHostMessage;

    const outputChannel = deps.getOutputChannel();
    const conversation = deps.getConversation();

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
          profiles: listAvailableLlmProfiles({ deps, outputChannel }),
          activeProfileId: initSettings.llm.profileId ?? null,
        });

        void postToolsList();

        void host.postMessage({
          type: 'serverListUpdated',
          servers: initSettings.servers,
          serverUrl: initSettings.serverUrl ?? '',
        });

        void host.postMessage({
          type: 'halSettings',
          hal: initSettings.hal,
        });

        // Welcome page: communicate whether API keys are present so the UI can show onboarding prompts.
        void (async () => {
          const status = await computeWelcomeSecretStatus({ context, settings: initSettings });
          void host.postMessage({ type: 'welcomeSecretStatus', hasProviderKey: status.hasProviderKey, hasGeminiKey: status.hasGeminiKey });
        })();

        deps.flushConversationEventBacklog({
          postMessage: host.postMessage,
          clientConversationId: message.conversationId,
          clientLastSeenSeq: message.lastSeenSeq,
        });

        break;
      }
      case 'openhandsE2E': {
        if (e2eEnabled && message.event === 'ready') {
          deps.setWebviewE2EInfo?.(normalizeE2EInfo(message.payload));
          deps.setWebviewE2EReady?.(true);
        }
        break;
      }
      case 'openSettingsPage':
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab');
        break;
      case 'openSettingsSecrets':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:openhands.openhands-tab openhands.secrets');
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
      case 'requestTools': {
        await postToolsList();
        break;
      }
      case 'setEnabledTools': {
        await handleSetEnabledTools({ deps, host, outputChannel, postStatusError, postToolsList, message });
        break;
      }
      case 'openSkill': {
        await handleOpenSkill(message);
        break;
      }
      case 'openWorkspaceFile': {
        await handleOpenWorkspaceFile(message);
        break;
      }
      case 'openMarkdownLink': {
        await handleOpenMarkdownLink(message);
        break;
      }
      case 'openWorkspaceDiff': {
        await handleOpenWorkspaceDiff({ context, message });
        break;
      }
      case 'requestHistory': {
        await handleRequestHistory({ deps, host, settingsMgr, outputChannel, historyTitleGenerationInFlight });
        break;
      }
      case 'deleteConversation': {
        await handleDeleteConversation({ deps, outputChannel, conversation, message });
        await handleRequestHistory({ deps, host, settingsMgr, outputChannel, historyTitleGenerationInFlight });
        break;
      }
      case 'restoreConversation': {
        handleRestoreConversation({ outputChannel, conversation, message });
        break;
      }
      case 'getConfig': {
        const settings = await settingsMgr.get();
        void host.postMessage({ type: 'config', serverUrl: settings.serverUrl ?? null, mode: deps.getConversationMode() });
        break;
      }
      case 'setLlmProfileId': {
        await handleSetLlmProfileId({ deps, host, settingsMgr, outputChannel, conversation, postStatusError, message });
        break;
      }
      case 'llmProfilesListRequest': {
        handleLlmProfilesListRequest({ deps, host, outputChannel, message });
        break;
      }
      case 'llmProfileLoadRequest': {
        handleLlmProfileLoadRequest({ deps, host, message });
        break;
      }
      case 'llmProfileSaveRequest': {
        await handleLlmProfileSaveRequest({ deps, host, settingsMgr, outputChannel, message });
        break;
      }
      case 'llmProfileDeleteRequest': {
        await handleLlmProfileDeleteRequest({ deps, host, context, settingsMgr, outputChannel, conversation, message });
        break;
      }
      case 'llmProfileApiKeyStatusRequest': {
        await handleLlmProfileApiKeyStatusRequest({ deps, host, context, message });
        break;
      }
      case 'llmProfileApiKeySetRequest': {
        await handleLlmProfileApiKeySetRequest({ deps, host, context, message });
        break;
      }
      case 'selectServer': {
        await handleSelectServer({ host, settingsMgr, postStatusError, message });
        break;
      }
      case 'addServer': {
        await handleAddServer({ host, settingsMgr, postStatusError, message });
        break;
      }
      case 'removeServer': {
        await handleRemoveServer({ host, settingsMgr, postStatusError, message });
        break;
      }
      case 'switchToLocal': {
        await handleSwitchToLocal({ host, settingsMgr });
        break;
      }
      case 'selectAttachments': {
        await handleSelectAttachments({ context, host, message });
        break;
      }
      case 'openAttachment': {
        await handleOpenAttachment(message);
        break;
      }
      case 'send': {
        if (!conversation) break;
        await handleSend({ context, deps, host, conversation, message, outputChannel });
        break;
      }
      case 'halTtsRequest': {
        await handleHalTtsRequest({ deps, host, settingsMgr, getElevenlabsTtsGate, message });
        break;
      }
      case 'halVoiceConfirmRequest': {
        await handleHalVoiceConfirmRequest({ deps, host, context, settingsMgr, outputChannel, message });
        break;
      }
      case 'command': {
        switch (message.command) {
          case 'cloudAuthLogin':
            await vscode.commands.executeCommand('openhands.cloudLogin');
            break;
          case 'cloudAuthLogout':
            await vscode.commands.executeCommand('openhands.cloudLogout');
            break;
          case 'reconnect':
            // Use the VS Code command so we re-evaluate settings (local ↔ remote) before reconnecting.
            await vscode.commands.executeCommand('openhands.reconnect');
            break;
          case 'pause':
            await conversation?.pause();
            break;
          case 'startNewConversation': {
            // Use the VS Code command so we re-evaluate settings (local ↔ remote) before starting.
            await vscode.commands.executeCommand('openhands.startNewConversation');
            const refreshedConversation = deps.getConversation();
            if (isLocalConversationToolControls(refreshedConversation)) {
              try {
                refreshedConversation.setTools(resolveLocalTools(getDefaultLocalToolIds()));
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                outputChannel?.appendLine(`[tools] Failed to reset tools: ${reason}`);
              }
              await postToolsList();
            }
            break;
          }
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
          case 'cancelTeleportAction':
            try {
              await vscode.commands.executeCommand('openhands._cancelTeleportToRemoteRuntime');
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              outputChannel?.appendLine(`[cancelTeleportAction] ${reason}`);
            }
            break;
          default:
            console.warn(`Unknown command received from webview: ${message.command}`);
            break;
        }
        break;
      }
      case 'renderedEventsResponse':
        handleRenderedEventsResponse({ deps, message });
        break;
      case 'uiStateResponse':
        handleUiStateResponse({ deps, message });
        break;
      case 'halStateResponse':
        handleHalStateResponse({ deps, message });
        break;
      case 'webviewConsole': {
        handleWebviewConsole({ deps, outputChannel, message });
        break;
      }
      case 'webviewError': {
        handleWebviewError({ deps, outputChannel, message });
        break;
      }
      case 'webviewNetwork': {
        handleWebviewNetwork({ deps, outputChannel, message });
        break;
      }
      case 'webviewWebSocket': {
        handleWebviewWebSocket({ deps, outputChannel, message });
        break;
      }
    }
  };
}
